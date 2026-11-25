import { effectiveQty } from '../lib/orderMath.js';
import { notFound, badRequest } from '../lib/errors.js';
import { computeShortage } from '../lib/shortage.js';
import { getBalance } from './ledgerService.js';

function assertPositiveId(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) {
    throw badRequest(`${name} must be a positive integer`);
  }
}

function addSafeIntegers(left, right, name) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${name} exceeds the supported range`);
  }
  return result;
}

export function getOnHand(db, itemId) {
  return getBalance(db, itemId);
}

export async function getReservedPackets(db, itemId, { excludeOrderId } = {}) {
  assertPositiveId(itemId, 'itemId');
  if (excludeOrderId !== undefined) {
    assertPositiveId(excludeOrderId, 'excludeOrderId');
  }

  const orders = await db.order.findMany({
    where: {
      status: { in: ['APPROVED', 'INVOICED'] },
      ...(excludeOrderId !== undefined ? { id: { not: excludeOrderId } } : {}),
      lines: { some: { itemId } }
    },
    select: {
      lines: {
        where: { itemId },
        select: { qty: true, approvedQty: true }
      },
      invoice: {
        select: {
          dispatches: {
            select: {
              lines: {
                where: { itemId },
                select: { qty: true }
              }
            }
          }
        }
      }
    }
  });

  let reservedPackets = 0;
  for (const order of orders) {
    const dispatchedQty = (order.invoice?.dispatches ?? [])
      .flatMap((dispatch) => dispatch.lines)
      .reduce(
        (total, line) => addSafeIntegers(total, line.qty, 'Dispatched quantity'),
        0
      );
    for (const line of order.lines) {
      reservedPackets = addSafeIntegers(
        reservedPackets,
        Math.max(0, effectiveQty(line) - dispatchedQty),
        'Reserved quantity'
      );
    }
  }
  return reservedPackets;
}

export async function checkOrderAvailability(db, orderId) {
  assertPositiveId(orderId, 'orderId');
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      lines: {
        orderBy: { id: 'asc' },
        include: { item: { select: { name: true } } }
      }
    }
  });
  if (!order) {
    throw notFound('Order not found');
  }

  const itemAvailability = new Map(await Promise.all(
    [...new Set(order.lines.map((line) => line.itemId))].map(async (itemId) => {
      const [onHand, reservedByOthers] = await Promise.all([
        getOnHand(db, itemId),
        getReservedPackets(db, itemId, { excludeOrderId: order.id })
      ]);
      return [itemId, { onHand, reservedByOthers }];
    })
  ));
  let totalShortPackets = 0;
  const messageShortages = new Map();
  const lines = order.lines.map((line) => {
    const { onHand, reservedByOthers } = itemAvailability.get(line.itemId);
    const effectiveQtyValue = effectiveQty(line);
    const shortage = computeShortage({
      requested: effectiveQtyValue,
      onHand,
      reserved: reservedByOthers
    });
    totalShortPackets = addSafeIntegers(
      totalShortPackets,
      shortage.shortBy,
      'Total shortage'
    );
    if (shortage.shortBy > 0) {
      messageShortages.set(
        line.item.name,
        addSafeIntegers(
          messageShortages.get(line.item.name) ?? 0,
          shortage.shortBy,
          'Item shortage'
        )
      );
    }
    return {
      lineId: line.id,
      itemId: line.itemId,
      name: line.item.name,
      requestedQty: line.qty,
      effectiveQty: effectiveQtyValue,
      onHand,
      reservedByOthers,
      ...shortage
    };
  });

  const shortageMessage = [...messageShortages]
    .map(([name, shortBy]) => `Short by ${shortBy} packets of ${name}`)
    .join('; ');
  return {
    orderId: order.id,
    orderNo: order.orderNo,
    status: order.status,
    allCovered: lines.every((line) => line.covered),
    totalShortPackets,
    message: shortageMessage || 'Stock covers this order',
    lines
  };
}
