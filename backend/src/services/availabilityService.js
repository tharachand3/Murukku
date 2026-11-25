import { effectiveQty } from '../lib/orderMath.js';
import { notFound, badRequest } from '../lib/errors.js';
import { computeShortage } from '../lib/shortage.js';
import { allocateFifo, batchesNeeded } from '../lib/planning.js';
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

function assertSafeQuantity(value, name) {
  const quantity = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError(`${name} exceeds the supported range`);
  }
  return quantity;
}

function addQuantity(map, key, value, name) {
  const total = (map.get(key) ?? 0) + value;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError(`${name} exceeds the supported range`);
  }
  map.set(key, total);
}

export async function getShortageSummary(db) {
  const items = await db.item.findMany({
    where: { type: 'FINISHED' },
    select: {
      id: true,
      name: true,
      finishedBoms: {
        where: { isActive: true },
        orderBy: { version: 'desc' },
        take: 1,
        select: { batchYieldQty: true }
      }
    },
    orderBy: { id: 'asc' }
  });
  if (items.length === 0) {
    return { items: [], totalShortPackets: 0 };
  }
  const itemIds = items.map(({ id }) => id);
  const [stockRows, reservedOrders, submittedOrders] = await Promise.all([
    db.stockMovement.groupBy({
      by: ['itemId'],
      where: { itemId: { in: itemIds } },
      _sum: { qtyChange: true }
    }),
    db.order.findMany({
      where: {
        status: { in: ['APPROVED', 'INVOICED'] },
        lines: { some: { itemId: { in: itemIds } } }
      },
      select: {
        lines: {
          where: { itemId: { in: itemIds } },
          select: { itemId: true, qty: true, approvedQty: true }
        },
        invoice: {
          select: {
            dispatches: {
              select: {
                lines: {
                  where: { itemId: { in: itemIds } },
                  select: { itemId: true, qty: true }
                }
              }
            }
          }
        }
      }
    }),
    db.order.findMany({
      where: {
        status: 'SUBMITTED',
        lines: { some: { itemId: { in: itemIds } } }
      },
      select: {
        id: true,
        orderNo: true,
        createdAt: true,
        customer: { select: { name: true } },
        lines: {
          where: { itemId: { in: itemIds } },
          select: { itemId: true, qty: true, approvedQty: true }
        }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
  ]);
  const onHandByItem = new Map(
    stockRows.map((row) => [
      row.itemId,
      assertSafeQuantity(row._sum.qtyChange ?? 0, 'On-hand quantity')
    ])
  );
  const reservedByItem = new Map();
  for (const order of reservedOrders) {
    const orderedByItem = new Map();
    for (const line of order.lines) {
      addQuantity(
        orderedByItem,
        line.itemId,
        effectiveQty(line),
        'Approved order quantity'
      );
    }
    const dispatchedByItem = new Map();
    for (const dispatch of order.invoice?.dispatches ?? []) {
      for (const line of dispatch.lines) {
        addQuantity(
          dispatchedByItem,
          line.itemId,
          line.qty,
          'Dispatched quantity'
        );
      }
    }
    for (const [itemId, orderedQty] of orderedByItem) {
      addQuantity(
        reservedByItem,
        itemId,
        Math.max(0, orderedQty - (dispatchedByItem.get(itemId) ?? 0)),
        'Reserved quantity'
      );
    }
  }

  const ordersByItem = new Map(itemIds.map((itemId) => [itemId, []]));
  const demandByOrderAndItem = new Map();
  for (const order of submittedOrders) {
    for (const line of order.lines) {
      let demand = demandByOrderAndItem.get(line.itemId);
      if (!demand) {
        demand = [];
        demandByOrderAndItem.set(line.itemId, demand);
      }
      let orderDemand = demand.find((entry) => entry.orderId === order.id);
      if (!orderDemand) {
        orderDemand = {
          orderId: order.id,
          orderNo: order.orderNo,
          customerName: order.customer.name,
          qty: 0
        };
        demand.push(orderDemand);
      }
      orderDemand.qty += effectiveQty(line);
      if (!Number.isSafeInteger(orderDemand.qty)) {
        throw new RangeError('Open order demand exceeds the supported range');
      }
    }
  }
  for (const [itemId, demand] of demandByOrderAndItem) {
    ordersByItem.set(itemId, demand);
  }

  const summaryItems = [];
  let totalShortPackets = 0;
  for (const item of items) {
    const onHand = onHandByItem.get(item.id) ?? 0;
    const reservedByApproved = reservedByItem.get(item.id) ?? 0;
    const free = Math.max(0, onHand - reservedByApproved);
    const demand = ordersByItem.get(item.id) ?? [];
    const openDemand = demand.reduce((total, order) => {
      const next = total + order.qty;
      if (!Number.isSafeInteger(next)) {
        throw new RangeError('Open order demand exceeds the supported range');
      }
      return next;
    }, 0);
    const allocation = allocateFifo(
      free,
      demand.map(({ orderId, qty }) => ({ orderId, qty }))
    );
    const allocationByOrder = new Map(
      allocation.map((entry) => [entry.orderId, entry])
    );
    const orders = demand.map((order) => ({
      orderId: order.orderId,
      orderNo: order.orderNo,
      customerName: order.customerName,
      qty: order.qty,
      allocated: allocationByOrder.get(order.orderId).allocated,
      shortBy: allocationByOrder.get(order.orderId).shortBy
    }));
    const itemShortPackets = orders.reduce((total, order) => total + order.shortBy, 0);
    if (!Number.isSafeInteger(itemShortPackets)) {
      throw new RangeError('Total item shortage exceeds the supported range');
    }
    if (itemShortPackets === 0) {
      continue;
    }
    totalShortPackets += itemShortPackets;
    if (!Number.isSafeInteger(totalShortPackets)) {
      throw new RangeError('Total shortage exceeds the supported range');
    }
    const batchYieldQty = item.finishedBoms[0]?.batchYieldQty;
    summaryItems.push({
      itemId: item.id,
      name: item.name,
      onHand,
      reservedByApproved,
      free,
      openDemand,
      totalShortPackets: itemShortPackets,
      suggestedBatches: batchYieldQty === undefined
        ? null
        : batchesNeeded(itemShortPackets, batchYieldQty),
      message: `Short by ${itemShortPackets} packets of ${item.name}`,
      orders
    });
  }
  return { items: summaryItems, totalShortPackets };
}
