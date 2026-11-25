import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { isValidIstDate, istDayRange } from '../../lib/istDate.js';
import {
  defineReport,
  formatIstDate,
  makeSection
} from '../../lib/reportKit.js';
import { allocateReceivables } from '../../lib/receivablesAgeing.js';

const filtersSchema = z.object({
  asOf: z.string().refine(isValidIstDate, 'Expected a valid YYYY-MM-DD IST date').optional(),
  customerId: z.coerce.number().int().positive().max(2147483647).optional(),
  detail: z.enum(['true', 'false']).default('false')
}).strict();

const filterDocs = [
  { name: 'asOf', type: 'date', description: 'Ageing cut-off date in IST; defaults to today' },
  { name: 'customerId', type: 'int', description: 'Restrict results to one customer' },
  { name: 'detail', type: 'boolean', description: 'Set true to include invoice-level ageing rows' }
];

const BUCKET_COLUMNS = [
  { key: 'bucket0To30Paise', label: '0-30 days', type: 'money' },
  { key: 'bucket31To60Paise', label: '31-60 days', type: 'money' },
  { key: 'bucket61To90Paise', label: '61-90 days', type: 'money' },
  { key: 'bucket91PlusPaise', label: '91+ days', type: 'money' }
];
const CUSTOMER_MONEY_KEYS = [
  'bucket0To30Paise',
  'bucket31To60Paise',
  'bucket61To90Paise',
  'bucket91PlusPaise',
  'outstandingPaise',
  'creditPaise'
];
const MAX_ROWS = 50000;

function assertMoney(value, name) {
  const number = value ?? 0;
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return number;
}

function sumRows(rows, keys) {
  const totals = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const row of rows) {
    for (const key of keys) {
      const value = assertMoney(row[key], key);
      const total = totals[key] + value;
      if (!Number.isSafeInteger(total)) {
        throw new RangeError(`${key} total exceeds the safe integer range`);
      }
      totals[key] = total;
    }
  }
  return totals;
}

function tooManyRows() {
  throw new AppError(422, 'TOO_MANY_ROWS', 'Report sections cannot exceed 50000 rows');
}

const receivablesAgeing = defineReport({
  key: 'receivables-ageing',
  title: 'Receivables Ageing',
  description: 'Customer and invoice balances aged by IST calendar days as of a selected date.',
  group: 'receivables',
  capability: 'payments:read',
  filtersSchema,
  filterDocs,
  async run(db, filters) {
    const asOfDate = filters.asOf ?? formatIstDate(new Date());
    const { lt: endExclusive } = istDayRange(asOfDate, asOfDate);
    const invoices = await db.invoice.findMany({
      where: {
        issueDate: { lt: endExclusive },
        OR: [
          { status: 'POSTED' },
          { status: 'CANCELLED', cancelledAt: { gte: endExclusive } }
        ],
        ...(filters.customerId !== undefined ? { customerId: filters.customerId } : {})
      },
      orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
      take: MAX_ROWS + 1,
      select: {
        id: true,
        invoiceNo: true,
        customerId: true,
        issueDate: true,
        totalPaise: true,
        customer: { select: { id: true, name: true, type: true } }
      }
    });
    if (invoices.length > MAX_ROWS) {
      tooManyRows();
    }

    const customerIds = [...new Set(invoices.map(({ customerId }) => customerId))];
    const payments = customerIds.length === 0
      ? []
      : await db.payment.findMany({
          where: {
            customerId: { in: customerIds },
            paymentDate: { lt: endExclusive }
          },
          orderBy: [{ paymentDate: 'asc' }, { id: 'asc' }],
          take: MAX_ROWS + 1,
          select: {
            customerId: true,
            invoiceId: true,
            amountPaise: true
          }
        });
    if (payments.length > MAX_ROWS) {
      tooManyRows();
    }

    const allocated = allocateReceivables({
      asOfDate,
      invoices: invoices.map((invoice) => ({
        ...invoice,
        issueDate: formatIstDate(invoice.issueDate)
      })),
      payments
    });
    const customerRows = allocated.customers
      .filter((customer) => customer.outstandingPaise > 0 || customer.creditPaise > 0)
      .sort((left, right) => (
        right.outstandingPaise - left.outstandingPaise ||
        left.customerName.localeCompare(right.customerName) ||
        left.customerId - right.customerId
      ));
    if (customerRows.length > MAX_ROWS || allocated.invoices.length > MAX_ROWS) {
      tooManyRows();
    }

    const customerSection = makeSection({
      key: 'customers',
      title: 'Customer Ageing',
      columns: [
        { key: 'customerId', label: 'Customer ID', type: 'int' },
        { key: 'customerName', label: 'Customer', type: 'text' },
        { key: 'customerType', label: 'Customer type', type: 'text' },
        ...BUCKET_COLUMNS,
        { key: 'outstandingPaise', label: 'Outstanding', type: 'money' },
        { key: 'creditPaise', label: 'Unapplied credit', type: 'money' }
      ],
      rows: customerRows,
      totals: sumRows(customerRows, CUSTOMER_MONEY_KEYS)
    });

    const sections = [customerSection];
    if (filters.detail === 'true') {
      const invoiceRows = allocated.invoices.map((invoice) => ({
        invoiceNo: invoice.invoiceNo,
        customerName: invoice.customerName,
        issueDate: invoice.issueDate,
        ageDays: invoice.ageDays,
        bucket: invoice.bucket,
        totalPaise: invoice.totalPaise,
        paidPaise: invoice.paidPaise,
        duePaise: invoice.duePaise
      }));
      sections.push(makeSection({
        key: 'invoices',
        title: 'Invoice Ageing',
        columns: [
          { key: 'invoiceNo', label: 'Invoice no.', type: 'text' },
          { key: 'customerName', label: 'Customer', type: 'text' },
          { key: 'issueDate', label: 'Issue date', type: 'date' },
          { key: 'ageDays', label: 'Age (days)', type: 'int' },
          { key: 'bucket', label: 'Age bucket', type: 'text' },
          { key: 'totalPaise', label: 'Invoice total', type: 'money' },
          { key: 'paidPaise', label: 'Payments applied', type: 'money' },
          { key: 'duePaise', label: 'Outstanding', type: 'money' }
        ],
        rows: invoiceRows,
        totals: sumRows(invoiceRows, ['totalPaise', 'paidPaise', 'duePaise'])
      }));
    }

    return {
      title: 'Receivables Ageing',
      period: { asOf: asOfDate },
      sections
    };
  }
});

export default receivablesAgeing;
