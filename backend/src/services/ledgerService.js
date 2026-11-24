import Decimal from 'decimal.js';
import { mulRateQty } from '../lib/money.js';
import { formatQty } from '../lib/units.js';
import {
  AppError,
  badRequest,
  notFound,
  unprocessable
} from '../lib/errors.js';

const INTEGER_MIN = -2147483648;
const INTEGER_MAX = 2147483647;
const ITEM_TYPES = new Set(['RAW', 'PACKAGING', 'FINISHED']);
const MOVEMENT_TYPES = new Set([
  'OPENING',
  'PURCHASE',
  'PRODUCTION_ISSUE',
  'PRODUCTION_OUTPUT',
  'PRODUCTION_SCRAP',
  'DISPATCH',
  'SALES_RETURN',
  'ADJUSTMENT'
]);
const SOURCE_TYPES = new Set([
  'OPENING',
  'PURCHASE',
  'PRODUCTION_RUN',
  'INVOICE',
  'DISPATCH',
  'CREDIT_NOTE',
  'ADJUSTMENT'
]);

function assertSafeBalance(balance) {
  if (!Number.isSafeInteger(balance)) {
    throw new RangeError('Stock balance exceeds the safe integer range');
  }
  return balance;
}

function validateDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw badRequest(`${name} must be a valid Date`);
  }
}

async function sumBalance(db, itemId, movementDate) {
  const where = {
    itemId,
    ...(movementDate ? { movementDate } : {})
  };
  const result = await db.stockMovement.aggregate({
    where,
    _sum: { qtyChange: true }
  });
  return assertSafeBalance(result._sum.qtyChange ?? 0);
}

function runTransaction(db, callback) {
  if (typeof db.$transaction === 'function') {
    return db.$transaction(callback, { maxWait: 10000, timeout: 30000 });
  }
  return callback(db);
}

async function addMovementInTransaction(db, movement) {
  if (!movement || typeof movement !== 'object' || Array.isArray(movement)) {
    throw badRequest('movement must be an object');
  }

  const {
    itemId,
    qtyChange,
    movementType,
    sourceType,
    sourceId,
    sourceRef,
    ratePaisePerBase,
    batchNo,
    expiryDate,
    movementDate = new Date(),
    userId,
    note,
    allowNegative = false
  } = movement;

  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw badRequest('itemId must be a positive integer');
  }
  if (
    !Number.isSafeInteger(qtyChange) ||
    qtyChange === 0 ||
    qtyChange < INTEGER_MIN ||
    qtyChange > INTEGER_MAX
  ) {
    throw badRequest('qtyChange must be a non-zero PostgreSQL integer');
  }
  if (!MOVEMENT_TYPES.has(movementType)) {
    throw badRequest('movementType is invalid');
  }
  if (!SOURCE_TYPES.has(sourceType)) {
    throw badRequest('sourceType is invalid');
  }
  if (typeof allowNegative !== 'boolean') {
    throw badRequest('allowNegative must be a boolean');
  }
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw badRequest('sourceId must be a positive integer');
  }
  if (typeof sourceRef !== 'string' || sourceRef.trim().length === 0) {
    throw badRequest('sourceRef is required');
  }
  validateDate(movementDate, 'movementDate');
  if (expiryDate !== undefined && expiryDate !== null) {
    validateDate(expiryDate, 'expiryDate');
  }
  if (userId !== undefined && userId !== null && (!Number.isSafeInteger(userId) || userId <= 0)) {
    throw badRequest('userId must be a positive integer');
  }

  if (qtyChange < 0) {
    await db.$queryRaw`SELECT id FROM "Item" WHERE id = ${itemId} FOR UPDATE`;
  }

  const item = await db.item.findUnique({
    where: { id: itemId },
    select: { id: true, name: true, isActive: true }
  });
  if (!item) {
    throw notFound(`Item ${itemId} not found`);
  }
  if (!item.isActive) {
    throw unprocessable(`Item "${item.name}" is inactive`, { itemId });
  }

  if (qtyChange < 0 && !allowNegative) {
    const balance = await sumBalance(db, itemId);
    if (balance + qtyChange < 0) {
      const requested = Math.abs(qtyChange);
      throw new AppError(
        422,
        'INSUFFICIENT_STOCK',
        `Insufficient stock for "${item.name}"`,
        {
          itemId,
          itemName: item.name,
          available: balance,
          requested,
          shortBy: requested - balance
        }
      );
    }
  }

  const hasRate = ratePaisePerBase !== undefined && ratePaisePerBase !== null;
  const valuePaise = hasRate
    ? mulRateQty(ratePaisePerBase, Math.abs(qtyChange))
    : null;
  const rate = hasRate ? new Decimal(ratePaisePerBase) : null;

  return db.stockMovement.create({
    data: {
      itemId,
      qtyChange,
      movementType,
      sourceType,
      sourceId,
      sourceRef,
      ratePaisePerBase: rate,
      valuePaise,
      batchNo,
      expiryDate,
      movementDate,
      createdById: userId,
      note
    }
  });
}

export function addMovement(db, movement) {
  return runTransaction(db, (tx) => addMovementInTransaction(tx, movement));
}

export function addMovements(db, movements) {
  if (!Array.isArray(movements)) {
    return Promise.reject(badRequest('movements must be an array'));
  }

  return runTransaction(db, async (tx) => {
    const created = [];
    for (const movement of movements) {
      created.push(await addMovementInTransaction(tx, movement));
    }
    return created;
  });
}

export async function getBalance(db, itemId, { asOf } = {}) {
  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw badRequest('itemId must be a positive integer');
  }
  if (asOf !== undefined) {
    validateDate(asOf, 'asOf');
  }

  return sumBalance(
    db,
    itemId,
    asOf === undefined ? undefined : { lte: asOf }
  );
}

export async function getBalances(db, { type, itemIds } = {}) {
  if (type !== undefined && !ITEM_TYPES.has(type)) {
    throw badRequest('type must be RAW, PACKAGING, or FINISHED');
  }
  if (
    itemIds !== undefined &&
    (!Array.isArray(itemIds) || itemIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
  ) {
    throw badRequest('itemIds must contain positive integers');
  }

  const items = await db.item.findMany({
    where: {
      ...(type !== undefined ? { type } : {}),
      ...(itemIds !== undefined ? { id: { in: itemIds } } : {})
    },
    include: {
      baseUnit: { select: { code: true } },
      displayUnit: { select: { code: true } }
    },
    orderBy: { code: 'asc' }
  });

  if (items.length === 0) {
    return [];
  }

  const grouped = await db.stockMovement.groupBy({
    by: ['itemId'],
    where: { itemId: { in: items.map(({ id }) => id) } },
    _sum: { qtyChange: true }
  });
  const balances = new Map(
    grouped.map(({ itemId, _sum }) => [itemId, assertSafeBalance(_sum.qtyChange ?? 0)])
  );

  return items.map((item) => {
    const balanceBase = balances.get(item.id) ?? 0;
    return {
      itemId: item.id,
      code: item.code,
      name: item.name,
      type: item.type,
      baseUnit: item.baseUnit.code,
      displayUnit: item.displayUnit.code,
      balanceBase,
      balanceDisplay: formatQty(balanceBase, item.displayUnit.code)
    };
  });
}

export async function getLedger(db, { itemId, from, to }) {
  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw badRequest('itemId must be a positive integer');
  }
  if (from !== undefined) {
    validateDate(from, 'from');
  }
  if (to !== undefined) {
    validateDate(to, 'to');
  }
  if (from && to && from > to) {
    throw badRequest('from must be earlier than or equal to to');
  }

  const openingBalance = from
    ? await sumBalance(db, itemId, { lt: from })
    : 0;
  const dateRange = {};
  if (from) dateRange.gte = from;
  if (to) dateRange.lte = to;
  const movements = await db.stockMovement.findMany({
    where: {
      itemId,
      ...(Object.keys(dateRange).length > 0 ? { movementDate: dateRange } : {})
    },
    include: {
      createdBy: { select: { id: true, name: true } }
    },
    orderBy: [{ movementDate: 'asc' }, { id: 'asc' }]
  });

  let balance = openingBalance;
  const rows = movements.map((movement) => {
    balance = assertSafeBalance(balance + movement.qtyChange);
    return {
      id: movement.id,
      date: movement.movementDate,
      movementType: movement.movementType,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      sourceRef: movement.sourceRef,
      qtyIn: movement.qtyChange > 0 ? movement.qtyChange : 0,
      qtyOut: movement.qtyChange < 0 ? Math.abs(movement.qtyChange) : 0,
      balance,
      rate: movement.ratePaisePerBase?.toString() ?? null,
      valuePaise: movement.valuePaise,
      batchNo: movement.batchNo,
      note: movement.note,
      user: movement.createdBy
    };
  });

  return { openingBalance, rows, closingBalance: balance };
}
