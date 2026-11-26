const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

export const UNIT_BASE_FACTORS = Object.freeze({
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  pcs: 1,
  packet: 1
});

function powerOfTen(scale) {
  return 10n ** BigInt(scale);
}

function roundHalfUp(numerator, denominator) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

function decimalPlacesForFraction(numerator, denominator) {
  let left = denominator / greatestCommonDivisor(numerator, denominator);
  let twos = 0;
  let fives = 0;
  while (left % 2n === 0n) {
    left /= 2n;
    twos += 1;
  }
  while (left % 5n === 0n) {
    left /= 5n;
    fives += 1;
  }
  return left === 1n ? Math.max(twos, fives) : Infinity;
}

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

function positiveFactor(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return BigInt(value);
}

export function parseDecimal(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Value must be entered as decimal text');
  }
  const match = text.trim().match(/^(-?)(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) {
    throw new TypeError('Enter a plain decimal with up to 6 decimal places');
  }
  const fraction = match[3] ?? '';
  const sign = match[1] === '-' ? '-' : '';
  return {
    n: BigInt(`${sign}${match[2]}${fraction}`),
    scale: fraction.length
  };
}

export function toBaseUnits(text, baseFactor) {
  const quantity = parseDecimal(text);
  const factor = positiveFactor(baseFactor, 'baseFactor');
  if (quantity.n <= 0n) {
    throw new RangeError('Quantity must be greater than zero');
  }
  const numerator = quantity.n * factor;
  const denominator = powerOfTen(quantity.scale);
  if (numerator % denominator !== 0n) {
    throw new RangeError('Quantity cannot be represented in base units');
  }
  const baseQuantity = numerator / denominator;
  if (baseQuantity > MAX_SAFE_INTEGER) {
    throw new RangeError('Base quantity exceeds the safe integer range');
  }
  return Number(baseQuantity);
}

export function mulToPaise(qtyText, ratePerUnitRupeesText, { baseFactor, unitFactor }) {
  const rate = parseDecimal(ratePerUnitRupeesText);
  const rateFactor = positiveFactor(unitFactor, 'unitFactor');

  if (rate.n < 0n) {
    throw new RangeError('Rate cannot be negative');
  }

  const quantityBase = BigInt(toBaseUnits(qtyText, baseFactor));

  const ratePaisePerUnit = roundHalfUp(rate.n * 100n, powerOfTen(rate.scale));
  if (decimalPlacesForFraction(ratePaisePerUnit, rateFactor) > 6) {
    throw new RangeError('Rate has more than 6 decimal places per base unit');
  }

  const amountPaise = roundHalfUp(ratePaisePerUnit * quantityBase, rateFactor);
  if (amountPaise > MAX_SAFE_INTEGER) {
    throw new RangeError('Estimated amount exceeds the safe integer range');
  }
  return Number(amountPaise);
}
