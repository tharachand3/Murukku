import Decimal from 'decimal.js';

function assertQuantity(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function formatPercentFromBasisPoints(bp) {
  const magnitude = BigInt(Math.abs(bp));
  const whole = (magnitude / 100n).toString();
  const fraction = (magnitude % 100n).toString().padStart(2, '0');
  const sign = bp < 0 ? '-' : '';
  return `${sign}${whole}.${fraction}`;
}

export function varianceBp(planned, actual) {
  assertQuantity(planned, 'Planned quantity');
  assertQuantity(actual, 'Actual quantity');
  if (planned === 0) {
    throw new RangeError('Planned quantity must not be zero');
  }

  const variance = new Decimal(actual)
    .minus(planned)
    .times(10_000)
    .div(planned)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  if (variance.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Variance exceeds the safe integer range');
  }
  return variance.toNumber();
}

export function isFlagged(bp, toleranceBp) {
  if (!Number.isSafeInteger(bp)) {
    throw new RangeError('Variance basis points must be a safe integer');
  }
  if (!Number.isSafeInteger(toleranceBp) || toleranceBp < 0) {
    throw new RangeError('Tolerance must be a non-negative safe integer');
  }
  return BigInt(Math.abs(bp)) > BigInt(toleranceBp);
}

export function describeVariance(planned, actual, toleranceBp) {
  assertQuantity(planned, 'Planned quantity');
  assertQuantity(actual, 'Actual quantity');
  if (planned === 0) {
    throw new RangeError('Planned quantity must not be zero');
  }
  if (!Number.isSafeInteger(toleranceBp) || toleranceBp < 0) {
    throw new RangeError('Tolerance must be a non-negative safe integer');
  }

  const diffQty = actual - planned;
  const bp = varianceBp(planned, actual);
  return {
    plannedQty: planned,
    actualQty: actual,
    diffQty,
    bp,
    pct: formatPercentFromBasisPoints(bp),
    flagged: isFlagged(bp, toleranceBp)
  };
}
