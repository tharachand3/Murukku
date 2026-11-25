function assertNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

export function allocateFifo(free, orders) {
  assertNonNegativeInteger(free, 'free');
  if (!Array.isArray(orders)) {
    throw new TypeError('orders must be an array');
  }

  let remaining = free;
  return orders.map((order, index) => {
    if (
      !order ||
      !Number.isSafeInteger(order.orderId) ||
      order.orderId <= 0 ||
      !Number.isSafeInteger(order.qty) ||
      order.qty < 0
    ) {
      throw new TypeError(`orders[${index}] must have a positive orderId and non-negative integer qty`);
    }
    const allocated = Math.min(order.qty, remaining);
    remaining -= allocated;
    return {
      orderId: order.orderId,
      qty: order.qty,
      allocated,
      shortBy: order.qty - allocated
    };
  });
}

export function batchesNeeded(shortPackets, batchYieldQty) {
  assertNonNegativeInteger(shortPackets, 'shortPackets');
  if (!Number.isSafeInteger(batchYieldQty) || batchYieldQty <= 0) {
    throw new RangeError('batchYieldQty must be a positive safe integer');
  }
  if (shortPackets === 0) {
    return 0;
  }
  return Math.ceil(shortPackets / batchYieldQty);
}
