import { prisma } from '../lib/prisma.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { formatQty, toBase, UNITS } from '../lib/units.js';
import { writeAudit } from '../lib/audit.js';
import { addMovement, getBalance } from './ledgerService.js';
import { getAverageRate } from './costingService.js';
import { nextNumber } from './numberingService.js';

const REASONS = new Set([
  'DAMAGE',
  'EXPIRY',
  'COUNT_CORRECTION',
  'SPILLAGE',
  'OTHER'
]);
const POSTGRES_INT_MAX = 2147483647;

const adjustmentInclude = {
  item: {
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      baseUnit: { select: { code: true, dimension: true } },
      displayUnit: { select: { code: true } }
    }
  },
  createdBy: {
    select: { id: true, name: true }
  }
};

function presentAdjustment(adjustment, extra = {}) {
  const qtyBase = Math.abs(adjustment.qtyChange);
  const displayUnit = adjustment.item.displayUnit.code;
  return {
    ...adjustment,
    direction: adjustment.qtyChange > 0 ? 'IN' : 'OUT',
    qtyBase,
    qtyDisplay: formatQty(qtyBase, displayUnit),
    ...extra
  };
}

function toBaseQuantity(qty, unit) {
  try {
    return toBase(qty, unit);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw badRequest(error.message);
    }
    throw error;
  }
}

export async function createAdjustment(userId, input) {
  if (!Number.isSafeInteger(userId) || userId <= 0 || userId > POSTGRES_INT_MAX) {
    throw badRequest('userId must be a positive integer');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Adjustment input must be an object');
  }
  if (!Number.isSafeInteger(input.itemId) || input.itemId <= 0 || input.itemId > POSTGRES_INT_MAX) {
    throw badRequest('itemId must be a positive integer');
  }
  if (input.direction !== 'IN' && input.direction !== 'OUT') {
    throw badRequest('direction must be IN or OUT');
  }
  if (typeof input.reason !== 'string' || !REASONS.has(input.reason)) {
    throw badRequest('reason is invalid');
  }
  if (typeof input.qty !== 'string' || !/^\d+(?:\.\d+)?$/.test(input.qty.trim())) {
    throw badRequest('qty must be a positive decimal string');
  }
  if (typeof input.unit !== 'string' || !Object.hasOwn(UNITS, input.unit)) {
    throw badRequest(`Unknown unit "${input.unit}"`);
  }

  const qtyBase = toBaseQuantity(input.qty, input.unit);
  if (qtyBase <= 0) {
    throw badRequest('Adjustment quantity must be greater than zero');
  }
  if (qtyBase > POSTGRES_INT_MAX) {
    throw badRequest('Adjustment quantity exceeds the supported range');
  }
  if (input.reason.trim().length < 3) {
    throw badRequest('reason must contain at least 3 characters');
  }

  return prisma.$transaction(async (tx) => {
    const item = await tx.item.findUnique({
      where: { id: input.itemId },
      select: {
        id: true,
        name: true,
        isActive: true,
        baseUnit: { select: { code: true, dimension: true } }
      }
    });
    if (!item) {
      throw notFound('Item not found');
    }
    if (!item.isActive) {
      throw unprocessable(`Item "${item.name}" is inactive`, { itemId: item.id });
    }
    if (UNITS[input.unit].dimension !== item.baseUnit.dimension) {
      throw badRequest(
        `Unit "${input.unit}" is incompatible with item base unit "${item.baseUnit.code}"`
      );
    }

    const adjustmentDate = new Date();
    const ratePaisePerBase = (
      await getAverageRate(tx, item.id, { asOf: adjustmentDate })
    ).toString();
    const qtyChange = input.direction === 'IN' ? qtyBase : -qtyBase;
    const beforeBalance = await getBalance(tx, item.id);
    const number = await nextNumber(tx, 'ADJ', adjustmentDate);
    const adjustment = await tx.stockAdjustment.create({
      data: {
        number,
        itemId: item.id,
        qtyChange,
        reason: input.reason,
        note: input.note,
        createdById: userId,
        createdAt: adjustmentDate
      },
      include: adjustmentInclude
    });
    const movement = await addMovement(tx, {
      itemId: item.id,
      qtyChange,
      movementType: 'ADJUSTMENT',
      sourceType: 'ADJUSTMENT',
      sourceId: adjustment.id,
      sourceRef: number,
      ratePaisePerBase,
      movementDate: adjustmentDate,
      userId,
      note: input.note ? `${input.reason}: ${input.note}` : input.reason
    });
    const afterBalance = await getBalance(tx, item.id);

    await writeAudit(tx, {
      userId,
      action: 'CREATE',
      entity: 'StockAdjustment',
      entityId: adjustment.id,
      before: { itemId: item.id, balanceBase: beforeBalance },
      after: { ...adjustment, balanceBase: afterBalance }
    });

    return presentAdjustment(adjustment, {
      balanceBeforeBase: beforeBalance,
      balanceBeforeDisplay: formatQty(beforeBalance, adjustment.item.displayUnit.code),
      balanceAfterBase: afterBalance,
      balanceAfterDisplay: formatQty(afterBalance, adjustment.item.displayUnit.code),
      movement: {
        id: movement.id,
        ratePaisePerBase: movement.ratePaisePerBase.toString(),
        valuePaise: movement.valuePaise
      }
    });
  }, { maxWait: 10000, timeout: 30000 });
}

export async function listAdjustments(db, { itemId, from, to, page, limit }) {
  const createdAt = {};
  if (from) createdAt.gte = from;
  if (to) createdAt.lte = to;

  const adjustments = await db.stockAdjustment.findMany({
    where: {
      ...(itemId !== undefined ? { itemId } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {})
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * limit,
    take: limit,
    include: adjustmentInclude
  });

  return {
    items: adjustments.map((adjustment) => presentAdjustment(adjustment)),
    page,
    limit
  };
}
