function assertQuantity(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

export function computeShortage({ requested, onHand, reserved }) {
  assertQuantity(requested, 'requested');
  assertQuantity(onHand, 'onHand');
  assertQuantity(reserved, 'reserved');

  const free = Math.max(0, onHand - reserved);
  const shortBy = Math.max(0, requested - free);
  return {
    free,
    shortBy,
    covered: shortBy === 0
  };
}
