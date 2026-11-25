import Decimal from 'decimal.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { formatQty } from '../lib/units.js';
import {
  formatRupees,
  rateForDisplayUnit,
  valueAt,
  weightedAverage
} from '../lib/costMath.js';

const CostDecimal = Decimal.clone({ precision: 40 });
const PRICED_RECEIPT_TYPES = ['OPENING', 'PURCHASE', 'SALES_RETURN'];
const POSTGRES_INT_MAX = 2147483647;

export async function getAverageRate(db, itemId, { asOf } = {}) {
  if (!Number.isSafeInteger(itemId) || itemId <= 0 || itemId > POSTGRES_INT_MAX) {
    throw badRequest('itemId must be a positive integer');
  }
  if (asOf !== undefined && (!(asOf instanceof Date) || Number.isNaN(asOf.getTime()))) {
    throw badRequest('asOf must be a valid Date');
  }

  const movements = await db.stockMovement.findMany({
    where: {
      itemId,
      movementType: { in: PRICED_RECEIPT_TYPES },
      ratePaisePerBase: { not: null },
      ...(asOf ? { movementDate: { lte: asOf } } : {})
    },
    select: {
      qtyChange: true,
      ratePaisePerBase: true
    }
  });

  let totalQty = new CostDecimal(0);
  let totalValue = new CostDecimal(0);
  for (const movement of movements) {
    const qty = new CostDecimal(movement.qtyChange);
    const rate = new CostDecimal(movement.ratePaisePerBase.toString());
    totalQty = totalQty.plus(qty);
    totalValue = totalValue.plus(rate.times(qty));
  }

  return totalQty.isZero()
    ? new CostDecimal(0)
    : totalValue.div(totalQty);
}

function assertItemId(itemId) {
  if (!Number.isSafeInteger(itemId) || itemId <= 0 || itemId > POSTGRES_INT_MAX) {
    throw badRequest('itemId must be a positive integer');
  }
}

function assertAsOf(asOf) {
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
    throw badRequest('asOf must be a valid Date');
  }
}

function receiptWhere(itemId, asOf, movementTypes = PRICED_RECEIPT_TYPES) {
  return {
    itemId,
    movementType: { in: movementTypes },
    ratePaisePerBase: { not: null },
    qtyChange: { gt: 0 },
    movementDate: { lte: asOf }
  };
}

function safeNumber(value, label) {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return number;
}

function presentAverage(itemId, aggregate) {
  const receiptQty = safeNumber(aggregate._sum.qtyChange ?? 0, 'Receipt quantity');
  const receiptValuePaise = safeNumber(
    aggregate._sum.valuePaise ?? 0,
    'Receipt value'
  );
  const receiptCount = aggregate._count._all;
  return {
    itemId,
    ratePaisePerBase: weightedAverage(
      receiptQty === 0 ? [] : [{ qty: receiptQty, valuePaise: receiptValuePaise }]
    ),
    receiptQty,
    receiptValuePaise,
    receiptCount
  };
}

export async function getAverageRateAsOf(db, itemId, asOf = new Date()) {
  assertItemId(itemId);
  assertAsOf(asOf);
  return getAverageForTypes(db, itemId, asOf, PRICED_RECEIPT_TYPES);
}

async function getAverageForTypes(db, itemId, asOf, movementTypes) {
  const aggregate = await db.stockMovement.aggregate({
    where: receiptWhere(itemId, asOf, movementTypes),
    _sum: { qtyChange: true, valuePaise: true },
    _count: { _all: true }
  });
  return presentAverage(itemId, aggregate);
}

async function getCostingItem(db, itemId) {
  const item = await db.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      isActive: true,
      displayUnit: { select: { code: true, baseFactor: true } }
    }
  });
  if (!item) {
    throw notFound('Item not found');
  }
  return item;
}

function displayRate(rate, item) {
  const ratePerDisplayUnit = rateForDisplayUnit(
    rate,
    item.displayUnit.baseFactor
  );
  return {
    ratePerDisplayUnit,
    rateDisplay: ratePerDisplayUnit === null
      ? null
      : `${formatRupees(ratePerDisplayUnit)} per ${item.displayUnit.code}`
  };
}

export async function getCostBreakdown(db, itemId, asOf = new Date()) {
  assertItemId(itemId);
  assertAsOf(asOf);
  const item = await getCostingItem(db, itemId);
  const movementTypes = item.type === 'FINISHED' ? ['OPENING'] : PRICED_RECEIPT_TYPES;
  const [average, receipts] = await Promise.all([
    getAverageForTypes(db, itemId, asOf, movementTypes),
    db.stockMovement.findMany({
      where: receiptWhere(itemId, asOf, movementTypes),
      orderBy: [{ movementDate: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        movementDate: true,
        movementType: true,
        sourceRef: true,
        qtyChange: true,
        ratePaisePerBase: true,
        valuePaise: true
      }
    })
  ]);
  return {
    item: { id: item.id, code: item.code, name: item.name, type: item.type },
    asOf,
    ...average,
    ...displayRate(average.ratePaisePerBase, item),
    rateBasis: item.type === 'FINISHED' ? 'OPENING_ONLY' : 'WEIGHTED_RECEIPTS',
    receipts: receipts.map((receipt) => ({
      movementId: receipt.id,
      date: receipt.movementDate,
      movementType: receipt.movementType,
      sourceRef: receipt.sourceRef,
      qty: receipt.qtyChange,
      qtyDisplay: formatQty(receipt.qtyChange, item.displayUnit.code),
      ratePaisePerBase: receipt.ratePaisePerBase,
      valuePaise: receipt.valuePaise
    }))
  };
}

export async function costValue(db, itemId, qtyBase, asOf = new Date()) {
  assertItemId(itemId);
  if (!Number.isSafeInteger(qtyBase) || qtyBase < 0) {
    throw badRequest('qtyBase must be a non-negative safe integer');
  }
  const { ratePaisePerBase } = await getAverageRateAsOf(db, itemId, asOf);
  if (ratePaisePerBase === null) {
    throw new AppError(422, 'NO_COST_RATE', 'No priced receipts exist for this item', {
      itemId
    });
  }
  return {
    ratePaisePerBase,
    valuePaise: valueAt(ratePaisePerBase, qtyBase)
  };
}

export async function getAverageRates(db, { type, asOf = new Date() } = {}) {
  assertAsOf(asOf);
  if (type !== undefined && !['RAW', 'PACKAGING', 'FINISHED'].includes(type)) {
    throw badRequest('type must be RAW, PACKAGING, or FINISHED');
  }
  const items = await db.item.findMany({
    where: { isActive: true, ...(type ? { type } : {}) },
    orderBy: [{ code: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      displayUnit: { select: { code: true, baseFactor: true } }
    }
  });
  if (items.length === 0) {
    return { asOf, items: [] };
  }

  const grouped = await db.stockMovement.groupBy({
    by: ['itemId', 'movementType'],
    where: {
      itemId: { in: items.map(({ id }) => id) },
      movementType: { in: PRICED_RECEIPT_TYPES },
      ratePaisePerBase: { not: null },
      qtyChange: { gt: 0 },
      movementDate: { lte: asOf }
    },
    _sum: { qtyChange: true, valuePaise: true },
    _count: { _all: true }
  });
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const averagesByItem = new Map();
  for (const row of grouped) {
    const item = itemsById.get(row.itemId);
    if (item.type === 'FINISHED' && row.movementType !== 'OPENING') {
      continue;
    }
    const current = averagesByItem.get(row.itemId) ?? {
      itemId: row.itemId,
      qtyChange: 0,
      valuePaise: 0,
      count: 0
    };
    current.qtyChange += safeNumber(row._sum.qtyChange ?? 0, 'Receipt quantity');
    current.valuePaise += safeNumber(row._sum.valuePaise ?? 0, 'Receipt value');
    current.count += row._count._all;
    averagesByItem.set(row.itemId, current);
  }
  return {
    asOf,
    items: items.map((item) => {
      const groupedAverage = averagesByItem.get(item.id);
      const average = groupedAverage
        ? presentAverage(item.id, {
            _sum: {
              qtyChange: groupedAverage.qtyChange,
              valuePaise: groupedAverage.valuePaise
            },
            _count: { _all: groupedAverage.count }
          })
        : {
        itemId: item.id,
        ratePaisePerBase: null,
        receiptQty: 0,
        receiptValuePaise: 0,
        receiptCount: 0
      };
      return {
        item: {
          id: item.id,
          code: item.code,
          name: item.name,
          type: item.type
        },
        ...average,
        ...displayRate(average.ratePaisePerBase, item),
        rateBasis: item.type === 'FINISHED' ? 'OPENING_ONLY' : 'WEIGHTED_RECEIPTS'
      };
    })
  };
}
