import { getBalances } from './ledgerService.js';

export async function getFinishedAvailability(db) {
  const items = await db.item.findMany({
    where: { type: 'FINISHED', isActive: true },
    select: { id: true, name: true }
  });
  const balances = await getBalances(db, {
    type: 'FINISHED',
    itemIds: items.map(({ id }) => id)
  });
  const balanceById = new Map(balances.map((item) => [item.itemId, item.balanceBase]));

  const openOrders = await db.order.findMany({
    where: { status: { in: ['APPROVED', 'INVOICED'] } },
    select: {
      lines: { select: { itemId: true, qty: true, approvedQty: true } },
      invoice: {
        select: {
          status: true,
          lines: { select: { itemId: true, qty: true } },
          dispatches: {
            select: {
              lines: { select: { itemId: true, qty: true } }
            }
          }
        }
      }
    }
  });
  const reservedByItem = new Map();
  for (const order of openOrders) {
    if (order.invoice?.status === 'CANCELLED') {
      continue;
    }

    const orderedByItem = new Map();
    const lines = order.invoice?.lines.length
      ? order.invoice.lines
      : order.lines.map((line) => ({
          ...line,
          qty: line.approvedQty ?? line.qty
        }));
    for (const line of lines) {
      orderedByItem.set(
        line.itemId,
        (orderedByItem.get(line.itemId) ?? 0) + line.qty
      );
    }

    const dispatchedByItem = new Map();
    for (const dispatch of order.invoice?.dispatches ?? []) {
      for (const line of dispatch.lines) {
        dispatchedByItem.set(
          line.itemId,
          (dispatchedByItem.get(line.itemId) ?? 0) + line.qty
        );
      }
    }
    for (const [itemId, orderedQty] of orderedByItem) {
      const remainingQty = Math.max(
        0,
        orderedQty - (dispatchedByItem.get(itemId) ?? 0)
      );
      reservedByItem.set(itemId, (reservedByItem.get(itemId) ?? 0) + remainingQty);
    }
  }

  return items.map(({ id, name }) => ({
    itemId: id,
    name,
    availablePackets: (balanceById.get(id) ?? 0) - (reservedByItem.get(id) ?? 0)
  }));
}
