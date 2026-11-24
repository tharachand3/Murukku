import Decimal from 'decimal.js';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { formatQty, toBase, UNITS } from '../lib/units.js';
import { mulRateQty, paiseToRupeesString, rupeesToPaise } from '../lib/money.js';
import { writeAudit } from '../lib/audit.js';
import { addMovement } from './ledgerService.js';
import { nextNumber } from './numberingService.js';

const PurchaseDecimal = Decimal.clone({ precision: 40 });
const POSTGRES_INT_MAX = 2147483647;

const purchaseInclude = {
  supplier: {
    select: { id: true, name: true, gstin: true, stateCode: true }
  },
  createdBy: {
    select: { id: true, name: true }
  },
  lines: {
    orderBy: { id: 'asc' },
    include: {
      item: {
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          baseUnit: { select: { code: true } },
          displayUnit: { select: { code: true } }
        }
      }
    }
  }
};

function convertInput(operation) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw badRequest(error.message);
    }
    throw error;
  }
}

function presentPurchase(purchase) {
  return {
    ...purchase,
    totalDisplay: paiseToRupeesString(purchase.totalPaise),
    lines: purchase.lines.map((line) => ({
      ...line,
      qtyBase: line.qty,
      qtyDisplay: formatQty(line.qty, line.item.displayUnit.code),
      ratePaisePerBase: line.ratePaisePerBase.toString(),
      rateDisplay: `${line.ratePaisePerBase.toString()} paise/${line.item.baseUnit.code}`,
      amountDisplay: paiseToRupeesString(line.amountPaise)
    }))
  };
}

function validateDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw badRequest(`${name} must be a valid Date`);
  }
}

function prepareLine(line, itemsById) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) {
    throw badRequest('Each purchase line must be an object');
  }
  if (
    !Number.isSafeInteger(line.itemId) ||
    line.itemId <= 0 ||
    line.itemId > POSTGRES_INT_MAX
  ) {
    throw badRequest('itemId must be a positive integer');
  }

  const item = itemsById.get(line.itemId);
  if (!item) {
    throw notFound(`Item ${line.itemId} not found`);
  }
  if (!['RAW', 'PACKAGING'].includes(item.type)) {
    throw unprocessable(`Item "${item.name}" is not purchasable`);
  }
  if (typeof line.unit !== 'string' || !Object.hasOwn(UNITS, line.unit)) {
    throw badRequest(`Unknown unit "${line.unit}"`);
  }
  if (UNITS[line.unit].dimension !== item.baseUnit.dimension) {
    throw badRequest(
      `Unit "${line.unit}" is incompatible with item base unit "${item.baseUnit.code}"`
    );
  }

  const qtyBase = convertInput(() => toBase(line.qty, line.unit));
  if (qtyBase <= 0) {
    throw badRequest('Purchase quantity must be greater than zero');
  }
  if (qtyBase > POSTGRES_INT_MAX) {
    throw badRequest('Purchase quantity exceeds the supported range');
  }

  const ratePerUnitPaise = convertInput(() => rupeesToPaise(line.ratePerUnitRupees));
  const ratePaisePerBase = new PurchaseDecimal(ratePerUnitPaise)
    .div(UNITS[line.unit].factor);
  if (ratePaisePerBase.decimalPlaces() > 6) {
    throw badRequest('Rate has more than 6 decimal places per base unit');
  }
  const amountPaise = convertInput(() => mulRateQty(ratePaisePerBase, qtyBase));
  if (amountPaise > POSTGRES_INT_MAX) {
    throw badRequest('Purchase line amount exceeds the supported range');
  }

  if (line.expiryDate !== undefined && line.expiryDate !== null) {
    validateDate(line.expiryDate, 'expiryDate');
  }

  return {
    itemId: line.itemId,
    qtyBase,
    ratePaisePerBase,
    amountPaise,
    batchNo: line.batchNo,
    expiryDate: line.expiryDate,
    item
  };
}

export async function createPurchase(userId, input) {
  if (!Number.isSafeInteger(userId) || userId <= 0 || userId > POSTGRES_INT_MAX) {
    throw badRequest('userId must be a positive integer');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Purchase input must be an object');
  }
  if (
    !Number.isSafeInteger(input.supplierId) ||
    input.supplierId <= 0 ||
    input.supplierId > POSTGRES_INT_MAX
  ) {
    throw badRequest('supplierId must be a positive integer');
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw badRequest('Purchase must contain at least one line');
  }

  const purchaseDate = input.purchaseDate ?? new Date();
  validateDate(purchaseDate, 'purchaseDate');

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true, isActive: true }
    });
    if (!supplier) {
      throw notFound(`Supplier ${input.supplierId} not found`);
    }
    if (!supplier.isActive) {
      throw unprocessable('Supplier is inactive', { supplierId: supplier.id });
    }

    const itemIds = [...new Set(
      input.lines
        .filter((line) =>
          line &&
          Number.isSafeInteger(line.itemId) &&
          line.itemId > 0 &&
          line.itemId <= POSTGRES_INT_MAX
        )
        .map(({ itemId }) => itemId)
    )];
    const items = await tx.item.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        name: true,
        type: true,
        baseUnit: { select: { code: true, dimension: true } }
      }
    });
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const lines = input.lines.map((line) => prepareLine(line, itemsById));
    const totalPaise = lines.reduce((total, line) => {
      const nextTotal = total + line.amountPaise;
      if (!Number.isSafeInteger(nextTotal) || nextTotal > POSTGRES_INT_MAX) {
        throw badRequest('Purchase total exceeds the supported range');
      }
      return nextTotal;
    }, 0);

    const number = await nextNumber(tx, 'PUR', purchaseDate);
    const purchase = await tx.purchase.create({
      data: {
        number,
        supplierId: supplier.id,
        purchaseDate,
        supplierInvoiceNo: input.supplierInvoiceNo,
        totalPaise,
        notes: input.notes,
        createdById: userId,
        lines: {
          create: lines.map((line) => ({
            itemId: line.itemId,
            qty: line.qtyBase,
            ratePaisePerBase: line.ratePaisePerBase,
            amountPaise: line.amountPaise,
            batchNo: line.batchNo,
            expiryDate: line.expiryDate
          }))
        }
      },
      include: purchaseInclude
    });

    for (const line of lines) {
      await addMovement(tx, {
        itemId: line.itemId,
        qtyChange: line.qtyBase,
        movementType: 'PURCHASE',
        sourceType: 'PURCHASE',
        sourceId: purchase.id,
        sourceRef: number,
        ratePaisePerBase: line.ratePaisePerBase,
        batchNo: line.batchNo,
        expiryDate: line.expiryDate,
        movementDate: purchaseDate,
        userId
      });
    }

    await writeAudit(tx, {
      userId,
      action: 'CREATE',
      entity: 'Purchase',
      entityId: purchase.id,
      after: purchase
    });

    return presentPurchase(purchase);
  }, { maxWait: 10000, timeout: 30000 });
}

export async function listPurchases(db, { page, limit, from, to, supplierId }) {
  const purchaseDate = {};
  if (from) purchaseDate.gte = from;
  if (to) purchaseDate.lte = to;

  const purchases = await db.purchase.findMany({
    where: {
      ...(supplierId !== undefined ? { supplierId } : {}),
      ...(Object.keys(purchaseDate).length ? { purchaseDate } : {})
    },
    orderBy: [{ purchaseDate: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * limit,
    take: limit,
    include: purchaseInclude
  });

  return { items: purchases.map(presentPurchase), page, limit };
}

export async function getPurchase(db, id) {
  if (!Number.isSafeInteger(id) || id <= 0 || id > POSTGRES_INT_MAX) {
    throw badRequest('id must be a positive integer');
  }

  const purchase = await db.purchase.findUnique({
    where: { id },
    include: purchaseInclude
  });
  if (!purchase) {
    throw notFound('Purchase not found');
  }
  return presentPurchase(purchase);
}
