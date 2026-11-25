import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { aggregatePurchaseLines, ratePerDisplayUnit } from '../../lib/purchaseAgg.js';
import { fromBase } from '../../lib/units.js';
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
  supplierId: z.coerce.number().int().positive().max(2147483647).optional(),
  itemId: z.coerce.number().int().positive().max(2147483647).optional(),
  type: z.enum(['RAW', 'PACKAGING']).optional(),
  ...pageFilterShape.shape
}).strict();

const filterDocs = [
  { name: 'from', type: 'date', description: 'First inclusive IST calendar day' },
  { name: 'to', type: 'date', description: 'Last inclusive IST calendar day' },
  { name: 'supplierId', type: 'int', description: 'Filter to one supplier' },
  { name: 'itemId', type: 'int', description: 'Filter to one purchased item' },
  { name: 'type', type: 'text', description: 'RAW or PACKAGING item type' },
  { name: 'page', type: 'int', description: 'Purchase line page number, starting at 1' },
  { name: 'limit', type: 'int', description: 'Lines per page, from 1 to 200' }
];

const lineColumns = [
  { key: 'purchaseNo', label: 'Purchase no.', type: 'text' },
  { key: 'date', label: 'Purchase date', type: 'date' },
  { key: 'supplierName', label: 'Supplier', type: 'text' },
  { key: 'supplierGstin', label: 'Supplier GSTIN', type: 'text' },
  { key: 'supplierInvoiceNo', label: 'Supplier invoice no.', type: 'text' },
  { key: 'itemCode', label: 'Item code', type: 'text' },
  { key: 'itemName', label: 'Item', type: 'text' },
  { key: 'type', label: 'Type', type: 'text' },
  { key: 'qty', label: 'Quantity', type: 'decimal' },
  { key: 'unit', label: 'Unit', type: 'text' },
  { key: 'ratePerUnit', label: 'Rate per unit (Rs)', type: 'decimal' },
  { key: 'amountPaise', label: 'Amount', type: 'money' },
  { key: 'batchNo', label: 'Batch no.', type: 'text' },
  { key: 'expiryDate', label: 'Expiry date', type: 'date' }
];

const supplierColumns = [
  { key: 'supplierName', label: 'Supplier', type: 'text' },
  { key: 'supplierGstin', label: 'Supplier GSTIN', type: 'text' },
  { key: 'purchases', label: 'Purchases', type: 'int' },
  { key: 'lines', label: 'Lines', type: 'int' },
  { key: 'amountPaise', label: 'Amount', type: 'money' }
];

const itemColumns = [
  { key: 'itemCode', label: 'Item code', type: 'text' },
  { key: 'itemName', label: 'Item', type: 'text' },
  { key: 'unit', label: 'Unit', type: 'text' },
  { key: 'qty', label: 'Quantity', type: 'decimal' },
  { key: 'amountPaise', label: 'Amount', type: 'money' },
  { key: 'avgRatePerUnit', label: 'Average rate per unit (Rs)', type: 'decimal' }
];

function safeInteger(value, name) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return value;
}

const purchaseRegister = defineReport({
  key: 'purchase-register',
  title: 'Purchase Register',
  description: 'Purchase lines and supplier/item summaries. Purchase amounts are recorded without GST; input tax credit is not tracked in v1.',
  group: 'purchases',
  capability: 'purchases:read',
  filtersSchema,
  filterDocs,
  async run(db, filters, { all = false } = {}) {
    const period = resolvePeriod(filters);
    const purchaseWhere = {
      purchaseDate: { gte: period.start, lt: period.endExclusive },
      ...(filters.supplierId !== undefined ? { supplierId: filters.supplierId } : {})
    };
    const where = {
      purchase: { is: purchaseWhere },
      ...(filters.itemId !== undefined ? { itemId: filters.itemId } : {}),
      ...(filters.type ? { item: { is: { type: filters.type } } } : {})
    };
    const [lines, amountAggregate] = await Promise.all([
      db.purchaseLine.findMany({
        where,
        orderBy: [
          { purchase: { purchaseDate: 'asc' } },
          { purchaseId: 'asc' },
          { id: 'asc' }
        ],
        take: 50001,
        select: {
          id: true,
          purchaseId: true,
          qty: true,
          ratePaisePerBase: true,
          amountPaise: true,
          batchNo: true,
          expiryDate: true,
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              type: true,
              displayUnit: { select: { code: true, baseFactor: true } }
            }
          },
          purchase: {
            select: {
              id: true,
              number: true,
              purchaseDate: true,
              supplierInvoiceNo: true,
              supplier: { select: { id: true, name: true, gstin: true } }
            }
          }
        }
      }),
      db.purchaseLine.aggregate({
        where,
        _sum: { amountPaise: true }
      })
    ]);

    if (lines.length > 50000) {
      throw new AppError(422, 'TOO_MANY_ROWS', 'Purchase register cannot exceed 50000 lines');
    }

    const totalAmountPaise = safeInteger(
      amountAggregate._sum.amountPaise ?? 0,
      'Purchase amount total'
    );
    const reportLines = lines.map((line) => ({
      purchaseNo: line.purchase.number,
      date: formatIstDate(line.purchase.purchaseDate),
      supplierName: line.purchase.supplier.name,
      supplierGstin: line.purchase.supplier.gstin,
      supplierInvoiceNo: line.purchase.supplierInvoiceNo,
      itemCode: line.item.code,
      itemName: line.item.name,
      type: line.item.type,
      qty: fromBase(
        safeInteger(line.qty, 'Purchase quantity'),
        line.item.displayUnit.code
      ).toFixed(),
      unit: line.item.displayUnit.code,
      ratePerUnit: ratePerDisplayUnit(
        line.ratePaisePerBase.toString(),
        line.item.displayUnit.baseFactor
      ),
      amountPaise: safeInteger(line.amountPaise, 'Purchase line amount'),
      batchNo: line.batchNo,
      expiryDate: line.expiryDate ? formatIstDate(line.expiryDate) : null
    }));

    const { bySupplier, byItem } = aggregatePurchaseLines(lines.map((line) => ({
      purchaseId: line.purchaseId,
      supplierId: line.purchase.supplier.id,
      supplierName: line.purchase.supplier.name,
      supplierGstin: line.purchase.supplier.gstin,
      itemId: line.item.id,
      itemCode: line.item.code,
      itemName: line.item.name,
      unit: line.item.displayUnit.code,
      baseFactor: line.item.displayUnit.baseFactor,
      qty: line.qty,
      amountPaise: line.amountPaise
    })));

    const lineRows = all
      ? reportLines
      : reportLines.slice((filters.page - 1) * filters.limit, filters.page * filters.limit);
    const linePage = all
      ? null
      : {
          page: filters.page,
          limit: filters.limit,
          total: reportLines.length,
          pages: Math.ceil(reportLines.length / filters.limit)
        };

    return {
      title: 'Purchase Register',
      period: { from: period.fromDate, to: period.toDate },
      sections: [
        makeSection({
          key: 'lines',
          title: 'Purchase lines',
          columns: lineColumns,
          rows: lineRows,
          totals: { amountPaise: totalAmountPaise },
          page: linePage
        }),
        makeSection({
          key: 'by-supplier',
          title: 'Purchases by supplier',
          columns: supplierColumns,
          rows: bySupplier,
          totals: { amountPaise: totalAmountPaise }
        }),
        makeSection({
          key: 'by-item',
          title: 'Purchases by item',
          columns: itemColumns,
          rows: byItem,
          totals: { amountPaise: totalAmountPaise }
        })
      ]
    };
  }
});

export default purchaseRegister;
