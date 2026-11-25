import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import {
  aggregateByProduct,
  roundRatioHalfUp,
  shareBp
} from '../../lib/salesAgg.js';
import {
  defineReport,
  makeSection,
  pageFilterShape,
  periodFilterShape,
  resolvePeriod
} from '../../lib/reportKit.js';

const filtersSchema = z.object({
  ...periodFilterShape.shape,
  customerId: z.coerce.number().int().positive().max(2147483647).optional(),
  itemId: z.coerce.number().int().positive().max(2147483647).optional(),
  ...pageFilterShape.shape
}).strict();

const FILTER_DOCS = [
  { name: 'from', type: 'date', description: 'First inclusive IST calendar day' },
  { name: 'to', type: 'date', description: 'Last inclusive IST calendar day' },
  { name: 'customerId', type: 'int', description: 'Filter to invoices for one customer' },
  { name: 'itemId', type: 'int', description: 'Filter to one product' },
  { name: 'page', type: 'int', description: 'Page number, starting at 1' },
  { name: 'limit', type: 'int', description: 'Rows per page, from 1 to 200' }
];

const columns = [
  { key: 'itemCode', label: 'Product code', type: 'text' },
  { key: 'itemName', label: 'Product', type: 'text' },
  { key: 'hsnCode', label: 'HSN', type: 'text' },
  { key: 'unit', label: 'Unit', type: 'text' },
  { key: 'invoices', label: 'Invoices', type: 'int' },
  { key: 'qty', label: 'Quantity', type: 'int' },
  { key: 'taxableValuePaise', label: 'Taxable value', type: 'money' },
  { key: 'avgRatePaise', label: 'Average rate', type: 'money' },
  { key: 'taxPaise', label: 'Tax', type: 'money' },
  { key: 'totalPaise', label: 'Total sales', type: 'money' },
  { key: 'sharePctBp', label: 'Share of filtered sales (bp)', type: 'percentBp' }
];

const salesByProduct = defineReport({
  key: 'sales-by-product',
  title: 'Sales by Product',
  description: 'Posted invoice sales grouped by product. Shares are relative to the filtered total and may not sum to exactly 10000 basis points after rounding.',
  group: 'sales',
  capability: 'reports:read',
  filtersSchema,
  filterDocs: FILTER_DOCS,
  async run(db, filters, { all = false } = {}) {
    const period = resolvePeriod(filters);
    const where = {
      invoice: {
        is: {
          status: 'POSTED',
          issueDate: { gte: period.start, lt: period.endExclusive },
          ...(filters.customerId !== undefined
            ? { customerId: filters.customerId }
            : {})
        }
      },
      ...(filters.itemId !== undefined ? { itemId: filters.itemId } : {})
    };
    const lines = await db.invoiceLine.findMany({
      where,
      orderBy: [{ invoice: { issueDate: 'asc' } }, { id: 'asc' }],
      take: 50001,
      select: {
        itemId: true,
        description: true,
        hsnCode: true,
        invoiceId: true,
        qty: true,
        taxableValuePaise: true,
        cgstPaise: true,
        sgstPaise: true,
        igstPaise: true,
        totalPaise: true,
        item: {
          select: {
            code: true,
            baseUnit: { select: { code: true } }
          }
        }
      }
    });
    if (lines.length > 50000) {
      throw new AppError(422, 'TOO_MANY_ROWS', 'Report input cannot exceed 50000 invoice lines');
    }

    const rows = aggregateByProduct(lines.map((line) => ({
      itemId: line.itemId,
      itemCode: line.item.code,
      itemName: line.description,
      hsnCode: line.hsnCode,
      unit: line.item.baseUnit.code,
      invoiceId: line.invoiceId,
      qty: line.qty,
      taxableValuePaise: line.taxableValuePaise,
      cgstPaise: line.cgstPaise,
      sgstPaise: line.sgstPaise,
      igstPaise: line.igstPaise,
      totalPaise: line.totalPaise
    })));
    const filteredTotalPaise = rows.reduce((sum, row) => sum + row.totalPaise, 0);
    if (!Number.isSafeInteger(filteredTotalPaise)) {
      throw new RangeError('Filtered product sales exceed the safe integer range');
    }
    const reportRows = rows.map((row) => ({
      itemCode: row.itemCode,
      itemName: row.itemName,
      hsnCode: row.hsnCode,
      unit: row.unit,
      invoices: row.invoices,
      qty: row.qty,
      taxableValuePaise: row.taxableValuePaise,
      avgRatePaise: row.avgRatePaise,
      taxPaise: row.taxPaise,
      totalPaise: row.totalPaise,
      sharePctBp: shareBp(row.totalPaise, filteredTotalPaise)
    }));
    const productPage = all
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
          throw new RangeError(`Product ${field} total exceeds the safe integer range`);
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
    totals.avgRatePaise = totals.qty === 0
      ? 0
      : roundRatioHalfUp(totals.taxableValuePaise, totals.qty, 'Average product rate');
    totals.sharePctBp = totals.totalPaise === 0 ? 0 : 10000;

    return {
      title: 'Sales by Product',
      period: { from: period.fromDate, to: period.toDate },
      sections: [makeSection({
        key: 'products',
        title: 'Sales by product',
        columns,
        rows: visibleRows,
        totals,
        page: productPage
      })]
    };
  }
});

export default salesByProduct;
