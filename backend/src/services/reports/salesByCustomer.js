import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import {
  aggregateByCustomer,
  roundRatioHalfUp,
  shareBp
} from '../../lib/salesAgg.js';
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
  customerType: z.enum(['RETAILER', 'DISTRIBUTOR']).optional(),
  customerId: z.coerce.number().int().positive().max(2147483647).optional(),
  ...pageFilterShape.shape
}).strict();

const FILTER_DOCS = [
  { name: 'from', type: 'date', description: 'First inclusive IST calendar day' },
  { name: 'to', type: 'date', description: 'Last inclusive IST calendar day' },
  { name: 'customerType', type: 'text', description: 'RETAILER or DISTRIBUTOR' },
  { name: 'customerId', type: 'int', description: 'Filter to one customer' },
  { name: 'page', type: 'int', description: 'Page number, starting at 1' },
  { name: 'limit', type: 'int', description: 'Rows per page, from 1 to 200' }
];

const columns = [
  { key: 'customerName', label: 'Customer', type: 'text' },
  { key: 'customerType', label: 'Customer type', type: 'text' },
  { key: 'customerGstin', label: 'GSTIN', type: 'text' },
  { key: 'stateName', label: 'State', type: 'text' },
  { key: 'invoices', label: 'Invoices', type: 'int' },
  { key: 'qty', label: 'Packets', type: 'int' },
  { key: 'taxableValuePaise', label: 'Taxable value', type: 'money' },
  { key: 'taxPaise', label: 'Tax', type: 'money' },
  { key: 'totalPaise', label: 'Total sales', type: 'money' },
  { key: 'avgInvoicePaise', label: 'Average invoice', type: 'money' },
  { key: 'sharePctBp', label: 'Share of filtered sales (bp)', type: 'percentBp' },
  { key: 'lastInvoiceDate', label: 'Last invoice date', type: 'date' }
];

const salesByCustomer = defineReport({
  key: 'sales-by-customer',
  title: 'Sales by Customer',
  description: 'Posted invoice sales grouped by customer. Shares are relative to the filtered total and may not sum to exactly 10000 basis points after rounding.',
  group: 'sales',
  capability: 'reports:read',
  filtersSchema,
  filterDocs: FILTER_DOCS,
  sectionDocs: [{ key: 'customers', title: 'Sales by customer' }],
  async run(db, filters, { all = false } = {}) {
    const period = resolvePeriod(filters);
    const where = {
      status: 'POSTED',
      issueDate: { gte: period.start, lt: period.endExclusive },
      ...(filters.customerId !== undefined ? { customerId: filters.customerId } : {}),
      ...(filters.customerType !== undefined
        ? { customer: { is: { type: filters.customerType } } }
        : {})
    };
    const invoices = await db.invoice.findMany({
      where,
      orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
      take: 50001,
      select: {
        id: true,
        customerId: true,
        issueDate: true,
        taxableValuePaise: true,
        cgstPaise: true,
        sgstPaise: true,
        igstPaise: true,
        totalPaise: true,
        customer: {
          select: { name: true, type: true, gstin: true, stateName: true }
        },
        lines: { select: { qty: true } }
      }
    });
    if (invoices.length > 50000) {
      throw new AppError(422, 'TOO_MANY_ROWS', 'Report input cannot exceed 50000 invoices');
    }

    const rows = aggregateByCustomer(invoices.map((invoice) => ({
      customerId: invoice.customerId,
      customerName: invoice.customer.name,
      customerType: invoice.customer.type,
      customerGstin: invoice.customer.gstin,
      stateName: invoice.customer.stateName,
      issueDate: formatIstDate(invoice.issueDate),
      taxableValuePaise: invoice.taxableValuePaise,
      cgstPaise: invoice.cgstPaise,
      sgstPaise: invoice.sgstPaise,
      igstPaise: invoice.igstPaise,
      totalPaise: invoice.totalPaise,
      qty: invoice.lines.reduce((sum, line) => sum + line.qty, 0)
    })));
    const filteredTotalPaise = rows.reduce((sum, row) => sum + row.totalPaise, 0);
    if (!Number.isSafeInteger(filteredTotalPaise)) {
      throw new RangeError('Filtered customer sales exceed the safe integer range');
    }
    const reportRows = rows.map((row) => ({
      customerName: row.customerName,
      customerType: row.customerType,
      customerGstin: row.customerGstin,
      stateName: row.stateName,
      invoices: row.invoices,
      qty: row.qty,
      taxableValuePaise: row.taxableValuePaise,
      taxPaise: row.taxPaise,
      totalPaise: row.totalPaise,
      avgInvoicePaise: row.avgInvoicePaise,
      sharePctBp: shareBp(row.totalPaise, filteredTotalPaise),
      lastInvoiceDate: row.lastInvoiceDate
    }));
    const customerPage = all
      ? null
      : {
          page: filters.page,
          limit: filters.limit,
          total: reportRows.length,
          pages: Math.ceil(reportRows.length / filters.limit)
        };
    const visibleRows = all
      ? reportRows
      : reportRows.slice((filters.page - 1) * filters.limit, filters.page * filters.limit);
    const totals = rows.reduce((result, row) => {
      for (const [field, value] of Object.entries({
        invoices: row.invoices,
        qty: row.qty,
        taxableValuePaise: row.taxableValuePaise,
        taxPaise: row.taxPaise,
        totalPaise: row.totalPaise
      })) {
        result[field] += value;
        if (!Number.isSafeInteger(result[field])) {
          throw new RangeError(`Customer ${field} total exceeds the safe integer range`);
        }
      }
      return result;
    }, {
      invoices: 0,
      qty: 0,
      taxableValuePaise: 0,
      taxPaise: 0,
      totalPaise: 0
    });
    totals.avgInvoicePaise = totals.invoices === 0
      ? 0
      : roundRatioHalfUp(totals.totalPaise, totals.invoices, 'Average invoice value');
    totals.sharePctBp = totals.totalPaise === 0 ? 0 : 10000;
    totals.lastInvoiceDate = rows.reduce(
      (latest, row) => row.lastInvoiceDate > latest ? row.lastInvoiceDate : latest,
      null
    );

    return {
      title: 'Sales by Customer',
      period: { from: period.fromDate, to: period.toDate },
      sections: [makeSection({
        key: 'customers',
        title: 'Sales by customer',
        columns,
        rows: visibleRows,
        totals,
        page: customerPage
      })]
    };
  }
});

export default salesByCustomer;
