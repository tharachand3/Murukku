import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { STATES } from '../../lib/states.js';
import {
  defineReport,
  formatIstDate,
  makeSection,
  pageFilterShape,
  periodFilterShape,
  resolvePeriod
} from '../../lib/reportKit.js';

const filtersSchema = z.object({
  ...periodFilterShape.shape,
  customerId: z.coerce.number().int().positive().max(2147483647).optional(),
  status: z.enum(['ALL', 'POSTED', 'CANCELLED']).default('ALL'),
  taxType: z.enum(['ALL', 'INTRA', 'INTER']).default('ALL'),
  ...pageFilterShape.shape
}).strict();

const moneyColumns = [
  { key: 'taxableValuePaise', label: 'Taxable value', type: 'money' },
  { key: 'cgstPaise', label: 'CGST', type: 'money' },
  { key: 'sgstPaise', label: 'SGST', type: 'money' },
  { key: 'igstPaise', label: 'IGST', type: 'money' },
  { key: 'totalPaise', label: 'Total', type: 'money' }
];

const MONEY_SUM_FIELDS = [
  'taxableValuePaise',
  'cgstPaise',
  'sgstPaise',
  'igstPaise',
  'totalPaise'
];

const FILTER_DOCS = [
  { name: 'from', type: 'date', description: 'First inclusive IST calendar day' },
  { name: 'to', type: 'date', description: 'Last inclusive IST calendar day' },
  { name: 'customerId', type: 'int', description: 'Filter to one customer' },
  { name: 'status', type: 'text', description: 'ALL, POSTED, or CANCELLED' },
  { name: 'taxType', type: 'text', description: 'ALL, INTRA, or INTER state tax' },
  { name: 'page', type: 'int', description: 'Page number, starting at 1' },
  { name: 'limit', type: 'int', description: 'Rows per page, from 1 to 200' }
];

function safeInteger(value, name) {
  const number = value ?? 0;
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return number;
}

function groupTotals(groups, status) {
  const group = groups.find((candidate) => candidate.status === status);
  const sum = group?._sum ?? {};
  return {
    invoices: safeInteger(group?._count?._all, `${status} invoice count`),
    ...Object.fromEntries(
      MONEY_SUM_FIELDS.map((field) => [field, safeInteger(sum[field], field)])
    )
  };
}

const salesRegister = defineReport({
  key: 'sales-register',
  title: 'Sales Register',
  description: 'Posted and cancelled invoices with GST totals for an IST period.',
  group: 'sales',
  capability: 'reports:read',
  filtersSchema,
  filterDocs: FILTER_DOCS,
  sectionDocs: [
    { key: 'invoices', title: 'Invoices' },
    { key: 'summary', title: 'Summary' }
  ],
  async run(db, filters, { all = false } = {}) {
    const period = resolvePeriod(filters);
    const where = {
      issueDate: { gte: period.start, lt: period.endExclusive },
      ...(filters.customerId !== undefined ? { customerId: filters.customerId } : {}),
      ...(filters.status !== 'ALL' ? { status: filters.status } : {}),
      ...(filters.taxType !== 'ALL'
        ? { isInterState: filters.taxType === 'INTER' }
        : {})
    };
    const [invoices, groups] = await Promise.all([
      db.invoice.findMany({
        where,
        orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
        ...(all ? { take: 50001 } : {
          skip: (filters.page - 1) * filters.limit,
          take: filters.limit
        }),
        select: {
          id: true,
          invoiceNo: true,
          issueDate: true,
          placeOfSupplyStateCode: true,
          isInterState: true,
          taxableValuePaise: true,
          cgstPaise: true,
          sgstPaise: true,
          igstPaise: true,
          totalPaise: true,
          status: true,
          customer: { select: { name: true, gstin: true } },
          lines: { select: { qty: true } },
          creditNotes: {
            select: { noteNo: true },
            orderBy: { id: 'asc' },
            take: 1
          }
        }
      }),
      db.invoice.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: {
          taxableValuePaise: true,
          cgstPaise: true,
          sgstPaise: true,
          igstPaise: true,
          totalPaise: true
        }
      })
    ]);

    if (all && invoices.length > 50000) {
      throw new AppError(422, 'TOO_MANY_ROWS', 'Report sections cannot exceed 50000 rows');
    }

    const invoiceTotals = groupTotals(groups, 'POSTED');
    const cancelledTotals = groupTotals(groups, 'CANCELLED');
    const total = groups.reduce(
      (sum, group) => sum + safeInteger(group._count?._all, 'Invoice count'),
      0
    );
    safeInteger(total, 'Invoice count');
    const rows = invoices.map((invoice) => ({
      invoiceNo: invoice.invoiceNo,
      issueDate: formatIstDate(invoice.issueDate),
      customerName: invoice.customer.name,
      customerGstin: invoice.customer.gstin,
      placeOfSupply: `${invoice.placeOfSupplyStateCode}-${STATES[invoice.placeOfSupplyStateCode] ?? 'Unknown'}`,
      taxType: invoice.isInterState ? 'IGST' : 'CGST+SGST',
      qty: invoice.lines.reduce(
        (sum, line) => safeInteger(sum + safeInteger(line.qty, 'Invoice line quantity'), 'Invoice quantity'),
        0
      ),
      taxableValuePaise: safeInteger(invoice.taxableValuePaise, 'Taxable value'),
      cgstPaise: safeInteger(invoice.cgstPaise, 'CGST'),
      sgstPaise: safeInteger(invoice.sgstPaise, 'SGST'),
      igstPaise: safeInteger(invoice.igstPaise, 'IGST'),
      totalPaise: safeInteger(invoice.totalPaise, 'Invoice total'),
      status: invoice.status,
      creditNoteNo: invoice.creditNotes[0]?.noteNo ?? null
    }));

    const invoicePage = all
      ? null
      : {
          page: filters.page,
          limit: filters.limit,
          total,
          pages: Math.ceil(total / filters.limit)
        };
    const postedTotals = Object.fromEntries(
      MONEY_SUM_FIELDS.map((field) => [field, invoiceTotals[field]])
    );
    const invoicesSection = makeSection({
      key: 'invoices',
      title: 'Invoices',
      columns: [
        { key: 'invoiceNo', label: 'Invoice no.', type: 'text' },
        { key: 'issueDate', label: 'Issue date', type: 'date' },
        { key: 'customerName', label: 'Customer', type: 'text' },
        { key: 'customerGstin', label: 'GSTIN', type: 'text' },
        { key: 'placeOfSupply', label: 'Place of supply', type: 'text' },
        { key: 'taxType', label: 'Tax type', type: 'text' },
        { key: 'qty', label: 'Quantity', type: 'int' },
        ...moneyColumns,
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'creditNoteNo', label: 'Credit note no.', type: 'text' }
      ],
      rows,
      totals: postedTotals,
      page: invoicePage
    });
    const summarySection = makeSection({
      key: 'summary',
      title: 'Summary',
      columns: [
        { key: 'label', label: 'Category', type: 'text' },
        { key: 'invoices', label: 'Invoices', type: 'int' },
        ...moneyColumns
      ],
      rows: [
        { label: 'Net sales (posted invoices)', ...invoiceTotals },
        { label: 'Cancelled by credit note (not counted)', ...cancelledTotals }
      ]
    });

    return {
      title: 'Sales Register',
      period: { from: period.fromDate, to: period.toDate },
      sections: [invoicesSection, summarySection]
    };
  }
});

export default salesRegister;
