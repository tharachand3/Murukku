import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { fromBase } from '../../lib/units.js';
import { valueAt } from '../../lib/costMath.js';
import { classifyMovement, reconcile } from '../../lib/stockClassify.js';
import {
  defineReport,
  makeSection,
  pageFilterShape,
  periodFilterShape,
  resolvePeriod
} from '../../lib/reportKit.js';
import { getAverageRates } from '../costingService.js';

const filtersSchema = z.object({
  ...periodFilterShape.shape,
  type: z.enum(['RAW', 'PACKAGING', 'FINISHED']).optional(),
  itemId: z.coerce.number().int().positive().max(2147483647).optional(),
  hideEmpty: z.enum(['true', 'false']).default('false')
    .transform((value) => value === 'true'),
  ...pageFilterShape.shape
}).strict();

const filterDocs = [
  { name: 'from', type: 'date', description: 'First inclusive IST calendar day' },
  { name: 'to', type: 'date', description: 'Last inclusive IST calendar day' },
  { name: 'type', type: 'text', description: 'RAW, PACKAGING, or FINISHED item type' },
  { name: 'itemId', type: 'int', description: 'Filter to one item' },
  { name: 'hideEmpty', type: 'text', description: 'Hide zero-balance items with no period movements' },
  { name: 'page', type: 'int', description: 'Page number, starting at 1' },
  { name: 'limit', type: 'int', description: 'Rows per page, from 1 to 200' }
];

const movementColumns = [
  'openingEntries',
  'purchases',
  'productionIn',
  'returnsIn',
  'adjustmentsIn',
  'productionOut',
  'scrapOut',
  'dispatchOut',
  'adjustmentsOut'
];

const itemColumns = [
  { key: 'itemCode', label: 'Item code', type: 'text' },
  { key: 'itemName', label: 'Item', type: 'text' },
  { key: 'type', label: 'Type', type: 'text' },
  { key: 'unit', label: 'Unit', type: 'text' },
  { key: 'openingQty', label: 'Opening quantity', type: 'decimal' },
  { key: 'openingEntriesQty', label: 'Opening entries', type: 'decimal' },
  { key: 'purchasesQty', label: 'Purchases', type: 'decimal' },
  { key: 'productionInQty', label: 'Production in', type: 'decimal' },
  { key: 'returnsInQty', label: 'Returns in', type: 'decimal' },
  { key: 'adjustmentsInQty', label: 'Adjustments in', type: 'decimal' },
  { key: 'productionOutQty', label: 'Production out', type: 'decimal' },
  { key: 'scrapOutQty', label: 'Scrap out', type: 'decimal' },
  { key: 'dispatchOutQty', label: 'Dispatch out', type: 'decimal' },
  { key: 'adjustmentsOutQty', label: 'Adjustments out', type: 'decimal' },
  { key: 'closingQty', label: 'Closing quantity', type: 'decimal' },
  { key: 'closingBaseQty', label: 'Closing base quantity', type: 'int' },
  { key: 'avgRatePerUnit', label: 'Average rate per unit (Rs)', type: 'decimal' },
  { key: 'closingValuePaise', label: 'Closing value', type: 'money' },
  { key: 'reconciles', label: 'Reconciliation', type: 'text' }
];

function safeInteger(value, name) {
  const number = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return number;
}

function addSafe(left, right, name) {
  return safeInteger(left + right, name);
}

function filterSql(filters) {
  const type = filters.type
    ? Prisma.sql`AND i."type"::text = ${filters.type}`
    : Prisma.empty;
  const itemId = filters.itemId
    ? Prisma.sql`AND i.id = ${filters.itemId}`
    : Prisma.empty;
  return Prisma.sql`${type} ${itemId}`;
}

function zeroMovementTotals() {
  return Object.fromEntries([
    ...movementColumns.map((column) => [column, 0]),
    ['movementCount', 0]
  ]);
}

const stockSummary = defineReport({
  key: 'stock-summary',
  title: 'Stock Summary',
  description: 'Opening stock, categorized movements, closing balances, and material valuation.',
  group: 'stock',
  capability: 'stock:read',
  filtersSchema,
  filterDocs,
  sectionDocs: [{ key: 'items', title: 'Stock summary by item' }],
  async run(db, filters) {
    const period = resolvePeriod(filters);
    const itemFilter = filterSql(filters);
    const asOf = new Date(period.endExclusive.getTime() - 1);
    const [openingRows, movementGroups, closingRows, averageRates] = await Promise.all([
      db.$queryRaw`
        SELECT i.id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
          i.type::text AS type, du.code AS unit,
          COALESCE(SUM(sm."qtyChange"), 0)::text AS quantity
        FROM "Item" i
        JOIN "Unit" du ON du.id = i."displayUnitId"
        LEFT JOIN "StockMovement" sm
          ON sm."itemId" = i.id AND sm."movementDate" < ${period.start}
        WHERE TRUE ${itemFilter}
        GROUP BY i.id, i.code, i.name, i.type, du.code
        ORDER BY i.type, i.code, i.id
      `,
      db.$queryRaw`
        SELECT sm."itemId", sm."movementType"::text AS "movementType",
          COALESCE(SUM(CASE WHEN sm."qtyChange" > 0
            THEN sm."qtyChange"::bigint ELSE 0::bigint END), 0)::text AS "positiveQty",
          COALESCE(SUM(CASE WHEN sm."qtyChange" < 0
            THEN -(sm."qtyChange"::bigint) ELSE 0::bigint END), 0)::text AS "negativeQty",
          COUNT(*) FILTER (WHERE sm."qtyChange" > 0)::text AS "positiveCount",
          COUNT(*) FILTER (WHERE sm."qtyChange" < 0)::text AS "negativeCount"
        FROM "StockMovement" sm
        JOIN "Item" i ON i.id = sm."itemId"
        WHERE sm."movementDate" >= ${period.start}
          AND sm."movementDate" < ${period.endExclusive}
          ${itemFilter}
        GROUP BY sm."itemId", sm."movementType"
      `,
      db.$queryRaw`
        SELECT i.id AS "itemId",
          COALESCE(SUM(sm."qtyChange"), 0)::text AS quantity
        FROM "Item" i
        LEFT JOIN "StockMovement" sm
          ON sm."itemId" = i.id AND sm."movementDate" < ${period.endExclusive}
        WHERE TRUE ${itemFilter}
        GROUP BY i.id
      `,
      getAverageRates(db, {
        ...(filters.type ? { type: filters.type } : {}),
        asOf
      })
    ]);

    if (openingRows.length > 50000) {
      throw new AppError(422, 'TOO_MANY_ROWS', 'Report sections cannot exceed 50000 rows');
    }

    const movementsByItem = new Map(
      openingRows.map(({ itemId }) => [itemId, zeroMovementTotals()])
    );
    let unclassifiedCount = 0;
    for (const movement of movementGroups) {
      const totals = movementsByItem.get(movement.itemId);
      if (!totals) continue;

      const positiveQty = safeInteger(movement.positiveQty, 'Positive movement quantity');
      const positiveCount = safeInteger(movement.positiveCount, 'Positive movement count');
      const negativeQty = safeInteger(movement.negativeQty, 'Negative movement quantity');
      const negativeCount = safeInteger(movement.negativeCount, 'Negative movement count');
      if (positiveCount > 0) {
        const classified = classifyMovement(movement.movementType, 1);
        totals[classified.column] = addSafe(
          totals[classified.column],
          positiveQty,
          'Movement category quantity'
        );
        if (classified.unclassified) {
          unclassifiedCount = addSafe(unclassifiedCount, positiveCount, 'Unclassified count');
        }
      }
      if (negativeCount > 0) {
        const classified = classifyMovement(movement.movementType, -1);
        totals[classified.column] = addSafe(
          totals[classified.column],
          negativeQty,
          'Movement category quantity'
        );
        if (classified.unclassified) {
          unclassifiedCount = addSafe(unclassifiedCount, negativeCount, 'Unclassified count');
        }
      }
      totals.movementCount = addSafe(
        totals.movementCount,
        positiveCount + negativeCount,
        'Movement count'
      );
    }

    const closingByItem = new Map(closingRows.map((row) => [
      row.itemId,
      safeInteger(row.quantity, 'Closing quantity')
    ]));
    const averageByItem = new Map(averageRates.items.map((row) => [row.item.id, row]));
    const rows = openingRows.map((item) => {
      const opening = safeInteger(item.quantity, 'Opening quantity');
      const closing = closingByItem.get(item.itemId) ?? 0;
      const movements = movementsByItem.get(item.itemId) ?? zeroMovementTotals();
      const average = averageByItem.get(item.itemId);
      const ratePaisePerBase = average?.ratePaisePerBase ?? null;
      const ratePaisePerDisplay = average?.ratePerDisplayUnit ?? null;
      const avgRatePerUnit = item.type === 'FINISHED' || ratePaisePerDisplay === null
        ? null
        : new Decimal(ratePaisePerDisplay.toString()).div(100).toFixed();
      const closingValuePaise = item.type === 'FINISHED' || ratePaisePerBase === null
        ? null
        : valueAt(ratePaisePerBase, closing);
      const isReconciled = reconcile({
        opening,
        movements,
        closing
      });

      return {
        itemCode: item.itemCode,
        itemName: item.itemName,
        type: item.type,
        unit: item.unit,
        openingQty: fromBase(opening, item.unit).toFixed(),
        openingEntriesQty: fromBase(movements.openingEntries, item.unit).toFixed(),
        purchasesQty: fromBase(movements.purchases, item.unit).toFixed(),
        productionInQty: fromBase(movements.productionIn, item.unit).toFixed(),
        returnsInQty: fromBase(movements.returnsIn, item.unit).toFixed(),
        adjustmentsInQty: fromBase(movements.adjustmentsIn, item.unit).toFixed(),
        productionOutQty: fromBase(movements.productionOut, item.unit).toFixed(),
        scrapOutQty: fromBase(movements.scrapOut, item.unit).toFixed(),
        dispatchOutQty: fromBase(movements.dispatchOut, item.unit).toFixed(),
        adjustmentsOutQty: fromBase(movements.adjustmentsOut, item.unit).toFixed(),
        closingQty: fromBase(closing, item.unit).toFixed(),
        closingBaseQty: closing,
        avgRatePerUnit,
        closingValuePaise,
        reconciles: isReconciled ? 'OK' : 'MISMATCH',
        movementCount: movements.movementCount
      };
    }).filter((row) => !(
      filters.hideEmpty &&
      row.movementCount === 0 &&
      row.closingBaseQty === 0 &&
      row.reconciles === 'OK'
    ));

    if (rows.length > 50000) {
      throw new AppError(422, 'TOO_MANY_ROWS', 'Report sections cannot exceed 50000 rows');
    }
    const totals = {
      closingValuePaise: rows.reduce(
        (total, row) => row.closingValuePaise === null
          ? total
          : addSafe(total, row.closingValuePaise, 'Closing value total'),
        0
      )
    };
    const pageRows = rows.map(({ movementCount, ...row }) => row);
    const start = (filters.page - 1) * filters.limit;
    const section = makeSection({
      key: 'items',
      title: 'Stock summary by item',
      columns: itemColumns,
      rows: pageRows.slice(start, start + filters.limit),
      totals,
      page: {
        page: filters.page,
        limit: filters.limit,
        total: pageRows.length,
        pages: Math.ceil(pageRows.length / filters.limit)
      }
    });
    if (unclassifiedCount > 0) {
      section.meta = { note: `Unclassified movements: ${unclassifiedCount}` };
    }

    return {
      title: 'Stock Summary',
      period: { from: period.fromDate, to: period.toDate },
      sections: [section]
    };
  }
});

export default stockSummary;
