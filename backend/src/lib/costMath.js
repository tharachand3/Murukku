import Decimal from 'decimal.js';
import { mulRateQty } from './money.js';

const CostDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP
});

function assertInteger(value, name, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${name} must be a safe integer of at least ${min}`);
  }
}

function indianGrouping(integer) {
  if (integer.length <= 3) {
    return integer;
  }
  return `${integer.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${integer.slice(-3)}`;
}

export function weightedAverage(receipts) {
  if (!Array.isArray(receipts)) {
    throw new TypeError('Receipts must be an array');
  }

  let totalQty = new CostDecimal(0);
  let totalValuePaise = new CostDecimal(0);
  for (const [index, receipt] of receipts.entries()) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
      throw new TypeError(`Receipt at index ${index} must be an object`);
    }
    assertInteger(receipt.qty, `Receipt quantity at index ${index}`);
    assertInteger(receipt.valuePaise, `Receipt value at index ${index}`);
    totalQty = totalQty.plus(receipt.qty);
    totalValuePaise = totalValuePaise.plus(receipt.valuePaise);
  }

  if (totalQty.isZero()) {
    return null;
  }
  return totalValuePaise.div(totalQty).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

export function rateForDisplayUnit(ratePaisePerBase, baseFactor) {
  if (ratePaisePerBase === null || ratePaisePerBase === undefined) {
    return null;
  }
  assertInteger(baseFactor, 'Display-unit base factor', { min: 1 });
  return new CostDecimal(ratePaisePerBase.toString()).times(baseFactor);
}

export function formatRupees(decimalPaise, { minDecimals = 2, maxDecimals = 4 } = {}) {
  if (
    !Number.isSafeInteger(minDecimals) ||
    !Number.isSafeInteger(maxDecimals) ||
    minDecimals < 0 ||
    maxDecimals < minDecimals
  ) {
    throw new RangeError('Decimal places must satisfy 0 <= minDecimals <= maxDecimals');
  }

  let rupees = new CostDecimal(decimalPaise.toString())
    .div(100)
    .toFixed(maxDecimals, Decimal.ROUND_HALF_UP);
  const negative = rupees.startsWith('-');
  if (negative) {
    rupees = rupees.slice(1);
  }
  let [whole, fraction = ''] = rupees.split('.');
  while (fraction.length > minDecimals && fraction.endsWith('0')) {
    fraction = fraction.slice(0, -1);
  }
  whole = indianGrouping(whole);
  return `Rs ${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function valueAt(ratePaisePerBase, qtyBase) {
  return mulRateQty(ratePaisePerBase, qtyBase);
}
