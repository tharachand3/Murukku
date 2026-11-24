import Decimal from 'decimal.js';

const MAX_SAFE_INTEGER = new Decimal(Number.MAX_SAFE_INTEGER);

function parseDecimal(value, name) {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    !(value instanceof Decimal)
  ) {
    throw new TypeError(`${name} must be a decimal string, number, or Decimal`);
  }

  let decimal;
  try {
    decimal = new Decimal(value);
  } catch {
    throw new TypeError(`${name} must be a finite decimal value`);
  }

  if (!decimal.isFinite()) {
    throw new TypeError(`${name} must be a finite decimal value`);
  }
  return decimal;
}

function safeInteger(decimal, name) {
  if (
    !decimal.isInteger() ||
    decimal.abs().greaterThan(MAX_SAFE_INTEGER)
  ) {
    throw new RangeError(`${name} must be a safe integer`);
  }
  return decimal.toNumber();
}

function formatIndianGrouping(integerString) {
  if (integerString.length <= 3) {
    return integerString;
  }

  const lastThree = integerString.slice(-3);
  const remaining = integerString.slice(0, -3);
  return `${remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`;
}

function expandExponent(value) {
  if (!/[eE]/.test(value)) {
    return value;
  }

  const [coefficient, exponentText] = value.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const sign = coefficient.startsWith('-') ? '-' : '';
  const unsigned = sign ? coefficient.slice(1) : coefficient;
  const [whole, fraction = ''] = unsigned.split('.');
  const digits = whole + fraction;
  const decimalPosition = whole.length + exponent;

  if (decimalPosition <= 0) {
    return `${sign}0.${'0'.repeat(-decimalPosition)}${digits}`;
  }
  if (decimalPosition >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

export function rupeesToPaise(input) {
  const rupees = parseDecimal(input, 'Rupees');
  if (rupees.isNegative()) {
    throw new RangeError('Rupees cannot be negative');
  }

  const paise = rupees.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return safeInteger(paise, 'Paise');
}

export function paiseToRupeesString(paise) {
  const amount = parseDecimal(paise, 'Paise');
  safeInteger(amount, 'Paise');

  const negative = amount.isNegative() && !amount.isZero();
  const absolutePaise = BigInt(amount.abs().toString());
  const rupees = (absolutePaise / 100n).toString();
  const remainder = (absolutePaise % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${formatIndianGrouping(rupees)}.${remainder}`;
}

export function mulRateQty(ratePaisePerBase, qtyBase) {
  const rate = parseDecimal(ratePaisePerBase, 'Rate');
  if (rate.isNegative()) {
    throw new RangeError('Rate cannot be negative');
  }
  if (!Number.isSafeInteger(qtyBase) || qtyBase < 0) {
    throw new RangeError('Base quantity must be a non-negative safe integer');
  }

  const amount = rate
    .times(qtyBase)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return safeInteger(amount, 'Amount in paise');
}

export function allocate(totalPaise, weights) {
  if (!Number.isSafeInteger(totalPaise)) {
    throw new RangeError('Total paise must be a safe integer');
  }
  if (!Array.isArray(weights)) {
    throw new TypeError('Weights must be an array');
  }
  if (weights.length === 0) {
    if (totalPaise === 0) {
      return [];
    }
    throw new RangeError('Cannot allocate a non-zero total without weights');
  }

  const decimalWeights = weights.map((weight, index) => {
    const decimal = parseDecimal(weight, `Weight at index ${index}`);
    if (decimal.isNegative()) {
      throw new RangeError('Weights cannot be negative');
    }
    return decimal;
  });

  const scalePlaces = decimalWeights.reduce(
    (places, weight) => Math.max(places, weight.decimalPlaces()),
    0
  );
  const scale = new Decimal(10).pow(scalePlaces);
  const integerWeights = decimalWeights.map((weight) => {
    const integerString = expandExponent(
      weight.times(scale).toDecimalPlaces(0).toString()
    );
    return BigInt(integerString);
  });
  const weightTotal = integerWeights.reduce((sum, weight) => sum + weight, 0n);

  if (weightTotal === 0n) {
    if (totalPaise === 0) {
      return weights.map(() => 0);
    }
    throw new RangeError('At least one weight must be greater than zero');
  }

  const negative = totalPaise < 0;
  const absoluteTotal = BigInt(Math.abs(totalPaise));
  const allocations = integerWeights.map((weight, index) => {
    const numerator = absoluteTotal * weight;
    return {
      index,
      remainder: numerator % weightTotal,
      units: numerator / weightTotal
    };
  });
  const assigned = allocations.reduce((sum, allocation) => sum + allocation.units, 0n);
  const leftover = Number(absoluteTotal - assigned);

  allocations
    .slice()
    .sort((left, right) => {
      if (left.remainder === right.remainder) {
        return left.index - right.index;
      }
      return left.remainder > right.remainder ? -1 : 1;
    })
    .slice(0, leftover)
    .forEach(({ index }) => {
      allocations[index].units += 1n;
    });

  return allocations.map(({ units }) => Number(negative ? -units : units));
}
