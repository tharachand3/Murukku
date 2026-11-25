import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
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
  itemId: z.coerce.number().int().positive().max(2147483647).optional(),
  type: z.enum(['RAW', 'PACKAGING', 'FINISHED']).optional(),
  ...pageFilterShape.shape
}).strict();

const filterDocs = [
  { name: 'from', type: 'date', description: 'First inclusive IST calendar day' },
  { name: 'to', type: 'date', description: 'Last inclusive IST calendar day' },
  { name: 'itemId', type: 'int', description: 'Filter to one item' },
  { name: 'type', type: 'text', description: 'RAW, PACKAGING, or FINISHED item type' },
  { name: 'page', type: 'int', description: 'Movement page number, starting at 1' },
  { name: 'limit', type: 'int', description: 'Movements per page, from 1 to 200' }
];

const movementColumns = [
  { key: 'itemCode', label: 'Item code', type: 'text' },
  { key: 'itemName', label: 'Item', type: 'text' },
  { key: 'unit', label: 'Unit', type: 'text' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'time', label: 'Time (IST)', type: 'text' },
  { key: 'movementType', label: 'Movement type', type: 'text' },
  { key: 'sourceType', label: 'Source type', type: 'text' },
  { key: 'sourceRef', label: 'Source reference', type: 'text' },
  { key: 'qtyIn', label: 'Quantity in', type: 'decimal' },
  { key: 'qtyOut', label: 'Quantity out', type: 'decimal' },
  { key: 'balance', label: 'Running balance', type: 'decimal' },
  { key: 'ratePerUnit', label: 'Rate per unit (Rs)', type: 'decimal' },
  { key: 'valuePaise', label: 'Value', type: 'money' },
  { key: 'batchNo', label: 'Batch no.', type: 'text' },
  { key: 'user', label: 'User', type: 'text' },
  { key: 'note', label: 'Note', type: 'text' }
];

const balanceColumns = [
  { key: 'itemCode', label: 'Item code', type: 'text' },
  { key: 'itemName', label: 'Item', type: 'text' },
  { key: 'unit', label: 'Unit', type: 'text' },
  { key: 'openingQty', label: 'Opening quantity', type: 'decimal' },
  { key: 'closingQty', label: 'Closing quantity', type: 'decimal' }
];

const istTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function safeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return number;
}

function addSafe(left, right, name) {
  return safeInteger(left + right, name);
}

function itemFilterSql(filters) {
  const type = filters.type
    ? Prisma.sql`AND i."type"::text = ${filters.type}`
    : Prisma.empty;
  const itemId = filters.itemId
    ? Prisma.sql`AND i.id = ${filters.itemId}`
    : Prisma.empty;
  return Prisma.sql`${type} ${itemId}`;
}

function displayQty(qtyBase, unit) {
  return fromBase(qtyBase, unit).toFixed();
}

function rateForDisplay(ratePaisePerBase, baseFactor) {
  if (ratePaisePerBase === null) return null;
  return new Decimal(ratePaisePerBase)
    .times(baseFactor)
    .div(100)
    .toFixed();
}

function formatIstTime(date) {
  return istTime.format(date);
}

const stockLedger = defineReport({
  key: 'stock-ledger',
  title: 'Stock Ledger',
  description: 'Stock movements with running balances and period opening/closing quantities.',
  group: 'stock',
  capability: 'stock:read',
  filtersSchema,
  filterDocs,
  sectionDocs: [
    { key: 'movements', title: 'Stock movements' },
    { key: 'balances', title: 'Opening and closing balances' }
  ],
  async run(db, filters) {
    const period = resolvePeriod(filters);
    const itemFilter = itemFilterSql(filters);
    const [openingRows, movements] = await Promise.all([
      db.$queryRaw`
        SELECT i.id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
          du.code AS unit, du."baseFactor"::text AS "baseFactor",
          COALESCE(SUM(opening."qtyChange"), 0)::text AS quantity
        FROM "Item" i
        JOIN "Unit" du ON du.id = i."displayUnitId"
        LEFT JOIN "StockMovement" opening
          ON opening."itemId" = i.id AND opening."movementDate" < ${period.start}
        WHERE TRUE ${itemFilter}
        GROUP BY i.id, i.code, i.name, du.code, du."baseFactor"
        ORDER BY i.code, i.id
      `,
      db.$queryRaw`
        SELECT sm.id, sm."itemId", i.code AS "itemCode", i.name AS "itemName",
          du.code AS unit, du."baseFactor"::text AS "baseFactor",
          sm."movementDate", sm."movementType"::text AS "movementType",
          sm."sourceType"::text AS "sourceType", sm."sourceRef",
          sm."qtyChange"::text AS "qtyChange",
          sm."ratePaisePerBase"::text AS "ratePaisePerBase",
          sm."valuePaise"::text AS "valuePaise",
          sm."batchNo", u.name AS "user", sm.note
        FROM "StockMovement" sm
        JOIN "Item" i ON i.id = sm."itemId"
        JOIN "Unit" du ON du.id = i."displayUnitId"
        LEFT JOIN "User" u ON u.id = sm."createdById"
        WHERE sm."movementDate" >= ${period.start}
          AND sm."movementDate" < ${period.endExclusive}
          ${itemFilter}
        ORDER BY i.code, sm."movementDate", sm.id
        LIMIT 20001
      `
    ]);

    if (movements.length > 20000) {
      throw new AppError(422, 'TOO_MANY_ROWS', 'Narrow the filters');
    }
    if (openingRows.length > 50000) {
      throw new AppError(422, 'TOO_MANY_ROWS', 'Narrow the filters');
    }

    const openingByItem = new Map(openingRows.map((row) => [
      row.itemId,
      safeInteger(row.quantity, 'Opening quantity')
    ]));
    const runningByItem = new Map(openingByItem);
    const periodQtyByItem = new Map(openingRows.map(({ itemId }) => [itemId, 0]));
    const movementRows = movements.map((movement) => {
      const qtyChange = safeInteger(movement.qtyChange, 'Movement quantity');
      const opening = runningByItem.get(movement.itemId) ?? 0;
      const balance = addSafe(opening, qtyChange, 'Running balance');
      runningByItem.set(movement.itemId, balance);
      periodQtyByItem.set(
        movement.itemId,
        addSafe(periodQtyByItem.get(movement.itemId) ?? 0, qtyChange, 'Period quantity')
      );
      const qtyInBase = qtyChange > 0 ? qtyChange : 0;
      const qtyOutBase = qtyChange < 0 ? -qtyChange : 0;

      return {
        itemCode: movement.itemCode,
        itemName: movement.itemName,
        unit: movement.unit,
        date: formatIstDate(movement.movementDate),
        time: formatIstTime(movement.movementDate),
        movementType: movement.movementType,
        sourceType: movement.sourceType,
        sourceRef: movement.sourceRef,
        qtyIn: displayQty(qtyInBase, movement.unit),
        qtyOut: displayQty(qtyOutBase, movement.unit),
        balance: displayQty(balance, movement.unit),
        ratePerUnit: rateForDisplay(
          movement.ratePaisePerBase,
          safeInteger(movement.baseFactor, 'Display-unit base factor')
        ),
        valuePaise: movement.valuePaise === null
          ? null
          : safeInteger(movement.valuePaise, 'Movement value'),
        batchNo: movement.batchNo,
        user: movement.user,
        note: movement.note
      };
    });

    const balanceRows = openingRows.map((item) => {
      const opening = openingByItem.get(item.itemId) ?? 0;
      const closing = runningByItem.get(item.itemId) ?? opening;
      const expectedClosing = addSafe(
        opening,
        periodQtyByItem.get(item.itemId) ?? 0,
        'Closing balance'
      );
      if (closing !== expectedClosing) {
        throw new AppError(
          500,
          'STOCK_RECONCILIATION_FAILED',
          `Running balance does not reconcile for item ${item.itemCode}`
        );
      }
      return {
        itemCode: item.itemCode,
        itemName: item.itemName,
        unit: item.unit,
        openingQty: displayQty(opening, item.unit),
        closingQty: displayQty(closing, item.unit)
      };
    });

    const start = (filters.page - 1) * filters.limit;
    const movementSection = makeSection({
      key: 'movements',
      title: 'Stock movements',
      columns: movementColumns,
      rows: movementRows.slice(start, start + filters.limit),
      page: {
        page: filters.page,
        limit: filters.limit,
        total: movementRows.length,
        pages: Math.ceil(movementRows.length / filters.limit)
      }
    });
    const balancesSection = makeSection({
      key: 'balances',
      title: 'Opening and closing balances',
      columns: balanceColumns,
      rows: balanceRows
    });

    return {
      title: 'Stock Ledger',
      period: { from: period.fromDate, to: period.toDate },
      sections: [movementSection, balancesSection]
    };
  }
});

export default stockLedger;
