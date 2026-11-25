import { AppError, badRequest, conflict } from '../lib/errors.js';
import { lineTaxablePaise, orderTaxablePaise } from '../lib/orderMath.js';
import { paiseToRupeesString } from '../lib/money.js';
import { writeAudit } from '../lib/audit.js';
import { getCustomer } from './masterDataService.js';
import { nextNumber } from './numberingService.js';
import { resolvePrices } from './pricingService.js';
import { prisma } from '../lib/prisma.js';

const POSTGRES_INT_MAX = 2147483647;
const orderInclude = {
  customer: { select: { id: true, name: true } },
  lines: {
    orderBy: { id: 'asc' },
    include: { item: { select: { id: true, name: true } } }
  }
};

function assertUser(user) {
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 ||
      user.id > POSTGRES_INT_MAX) {
    throw badRequest('user must have a valid id');
  }
}

function mergeLines(lines) {
  const merged = new Map();
  for (const line of lines) {
    const existing = merged.get(line.itemId);
    if (existing) {
      existing.qty += line.qty;
    } else {
      merged.set(line.itemId, { itemId: line.itemId, qty: line.qty });
    }
  }
  return [...merged.values()];
}

function presentOrder(order) {
  const lines = order.lines.map((line) => ({
    lineId: line.id,
    itemId: line.itemId,
    name: line.item.name,
    qty: line.qty,
    pricePaise: line.pricePaise,
    priceDisplay: `Rs ${paiseToRupeesString(line.pricePaise)}`,
    lineTotalPaise: lineTaxablePaise(line)
  }));
  // This total is the taxable base before GST; tax is calculated during invoicing.
  const taxableTotalPaise = orderTaxablePaise(order.lines);
  return {
    id: order.id,
    orderNo: order.orderNo,
    clientRef: order.clientRef,
    status: order.status,
    customer: order.customer,
    notes: order.notes,
    createdAt: order.createdAt,
    lines,
    taxableTotalPaise,
    totalDisplay: paiseToRupeesString(taxableTotalPaise)
  };
}

function resultFor(order, userId) {
  if (order.salesmanId !== userId) {
    throw new AppError(
      409,
      'CLIENT_REF_TAKEN',
      'This clientRef is already used by another salesman'
    );
  }
  return { duplicate: true, order: presentOrder(order) };
}

function isClientRefUniqueViolation(error) {
  if (error?.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes('clientRef')
    : typeof target === 'string' && target.toLowerCase().includes('clientref');
}

async function findClientRefOrder(db, clientRef) {
  return db.order.findUnique({
    where: { clientRef },
    include: orderInclude
  });
}

function orderableError(itemId) {
  return new AppError(
    422,
    'ITEM_NOT_ORDERABLE',
    'Order items must be active finished goods',
    { itemId }
  );
}

export async function createOrder(user, input) {
  assertUser(user);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Order input must be an object');
  }

  const create = async (tx) => {
    if (input.clientRef !== undefined) {
      const existing = await findClientRefOrder(tx, input.clientRef);
      if (existing) {
        return resultFor(existing, user.id);
      }
    }

    const customer = await getCustomer(tx, input.customerId, user);
    if (!customer.isActive) {
      throw new AppError(
        422,
        'CUSTOMER_INACTIVE',
        'Customer is inactive',
        { customerId: customer.id }
      );
    }

    const lines = mergeLines(input.lines);
    const itemIds = lines.map(({ itemId }) => itemId);
    const items = await tx.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, type: true, isActive: true }
    });
    const itemById = new Map(items.map((item) => [item.id, item]));
    for (const { itemId } of lines) {
      const item = itemById.get(itemId);
      if (!item || !item.isActive || item.type !== 'FINISHED') {
        throw orderableError(itemId);
      }
    }

    const prices = await resolvePrices(tx, customer.id, itemIds);
    const pricedLines = lines.map((line) => {
      const price = prices.get(line.itemId);
      if (!price) {
        throw new AppError(
          422,
          'NO_PRICE',
          'No customer or default price is set for this item',
          { customerId: customer.id, itemId: line.itemId }
        );
      }
      return { ...line, pricePaise: price.pricePaise };
    });
    try {
      orderTaxablePaise(pricedLines);
    } catch (error) {
      if (error instanceof RangeError) {
        throw badRequest('Order taxable total exceeds the supported range');
      }
      throw error;
    }

    const orderNo = await nextNumber(tx, 'ORD');
    const order = await tx.order.create({
      data: {
        orderNo,
        clientRef: input.clientRef ?? null,
        customerId: customer.id,
        salesmanId: user.id,
        status: 'SUBMITTED',
        notes: input.notes,
        lines: {
          create: pricedLines.map((line) => ({
            itemId: line.itemId,
            qty: line.qty,
            pricePaise: line.pricePaise,
            approvedQty: null,
            approvedPricePaise: null
          }))
        }
      },
      include: orderInclude
    });
    const summary = presentOrder(order);
    await writeAudit(tx, {
      userId: user.id,
      action: 'CREATE',
      entity: 'Order',
      entityId: order.id,
      after: summary
    });
    return { duplicate: false, order: summary };
  };

  try {
    return await prisma.$transaction(create, { maxWait: 60000, timeout: 60000 });
  } catch (error) {
    if (!input.clientRef || !isClientRefUniqueViolation(error)) {
      throw error;
    }
    const existing = await findClientRefOrder(prisma, input.clientRef);
    if (!existing) {
      throw error;
    }
    return resultFor(existing, user.id);
  }
}
