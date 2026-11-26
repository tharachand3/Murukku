const UNIT_FACTORS = Object.freeze({
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  pcs: 1,
  packet: 1
});

const INTEGER_MAX = 2147483647;

export function quantityToBase(value, unit, { allowZero = true } = {}) {
  const factor = UNIT_FACTORS[unit];
  if (!Number.isSafeInteger(factor)) {
    throw new TypeError(`Unsupported quantity unit "${unit}".`);
  }
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    throw new TypeError('Enter a non-negative decimal quantity.');
  }
  const [wholeText, fractionText = ''] = value.trim().split('.');
  const denominator = 10n ** BigInt(fractionText.length);
  const scaled = BigInt(wholeText) * denominator + BigInt(fractionText || '0');
  const baseNumerator = scaled * BigInt(factor);
  if (baseNumerator % denominator !== 0n) {
    throw new TypeError(`Quantity must be exactly representable in base ${unit === 'kg' ? 'g' : unit === 'l' ? 'ml' : 'units'}.`);
  }
  const base = baseNumerator / denominator;
  if (base > BigInt(INTEGER_MAX) || (!allowZero && base === 0n)) {
    throw new RangeError(allowZero
      ? 'Quantity exceeds the supported range.'
      : 'Enter a quantity greater than zero within the supported range.');
  }
  return Number(base);
}

export function formatBaseQuantity(baseQty, unit) {
  const factor = UNIT_FACTORS[unit];
  if (!Number.isSafeInteger(baseQty) || !Number.isSafeInteger(factor)) {
    throw new TypeError('Base quantity and unit must be valid.');
  }
  const scaled = BigInt(baseQty);
  const divisor = BigInt(factor);
  const whole = scaled / divisor;
  const remainder = scaled % divisor;
  if (remainder === 0n) return whole.toString();
  const decimals = String(factor).length - 1;
  const fraction = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fraction}`;
}

export function varianceBasisPoints(plannedQty, actualQty) {
  if (!Number.isSafeInteger(plannedQty) || plannedQty <= 0
    || !Number.isSafeInteger(actualQty) || actualQty < 0) {
    throw new TypeError('Variance requires a positive plan and a non-negative actual quantity.');
  }
  const difference = BigInt(actualQty) - BigInt(plannedQty);
  const numerator = difference * 10000n;
  const denominator = BigInt(plannedQty);
  const magnitude = numerator < 0n ? -numerator : numerator;
  let rounded = magnitude / denominator;
  if ((magnitude % denominator) * 2n >= denominator) rounded += 1n;
  return Number(numerator < 0n ? -rounded : rounded);
}

export function formatSignedVariance(bp) {
  if (!Number.isSafeInteger(bp)) {
    throw new TypeError('Variance must be an integer number of basis points.');
  }
  const absolute = Math.abs(bp);
  return `${bp > 0 ? '+' : bp < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}%`;
}
