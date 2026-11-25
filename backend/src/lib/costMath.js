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

export function computeRunCost({ materialCostPaise, overheadCostPaise, goodQty }) {
  assertInteger(materialCostPaise, 'Material cost');
  assertInteger(overheadCostPaise, 'Overhead cost');
  const totalCostPaise = materialCostPaise + overheadCostPaise;
  assertInteger(totalCostPaise, 'Total run cost');
  if (goodQty === undefined || goodQty === null || goodQty === 0) {
    return { totalCostPaise, costPerPacketPaise: null };
  }
  assertInteger(goodQty, 'Good quantity', { min: 1 });
  return {
    totalCostPaise,
    costPerPacketPaise: new CostDecimal(totalCostPaise)
      .div(goodQty)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
  };
}

export function formatPaiseDecimalAsRupees(decimalPaise, places = 2) {
  if (!Number.isSafeInteger(places) || places < 0 || places > 6) {
    throw new RangeError('Decimal places must be an integer from 0 to 6');
  }
  return formatRupees(decimalPaise, {
    minDecimals: places,
    maxDecimals: places
  });
}

export function splitCostPerPacket({ materialCostPaise, overheadCostPaise, goodQty }) {
  if (!Number.isSafeInteger(goodQty) || goodQty <= 0) {
    return null;
  }
  assertInteger(materialCostPaise, 'Material cost');
  assertInteger(overheadCostPaise, 'Overhead cost');

  const materialPerPacket = new CostDecimal(materialCostPaise)
    .div(goodQty)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  const overheadPerPacket = new CostDecimal(overheadCostPaise)
    .div(goodQty)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  return {
    materialPerPacket,
    overheadPerPacket,
    totalPerPacket: materialPerPacket.plus(overheadPerPacket)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
  };
}

export function marginPerPacket({ sellingPricePaise, costPerPacketPaise }) {
  if (
    sellingPricePaise === null ||
    sellingPricePaise === undefined ||
    costPerPacketPaise === null ||
    costPerPacketPaise === undefined ||
    !Number.isSafeInteger(sellingPricePaise) ||
    sellingPricePaise <= 0
  ) {
    return null;
  }
  const marginPaise = new CostDecimal(sellingPricePaise.toString())
    .minus(costPerPacketPaise instanceof Decimal
      ? costPerPacketPaise.toString()
      : costPerPacketPaise)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  const marginBp = Number(
    marginPaise.times(10000).div(sellingPricePaise)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toString()
  );
  if (!Number.isSafeInteger(marginBp)) {
    throw new RangeError('Margin basis points exceed the safe integer range');
  }
  return { marginPaise, marginBp };
}

export function formatMarginPct(bp) {
  if (!Number.isSafeInteger(bp)) {
    throw new RangeError('Margin basis points must be a safe integer');
  }
  const sign = bp < 0 ? '-' : '';
  const absolute = BigInt(Math.abs(bp));
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${sign}${whole}.${fraction}%`;
}

export function lineCostVariance({ plannedQty, issuedQty, ratePaisePerBase }) {
  assertInteger(plannedQty, 'Planned quantity');
  assertInteger(issuedQty, 'Issued quantity');
  const plannedCostPaise = mulRateQty(ratePaisePerBase, plannedQty);
  const actualCostPaise = mulRateQty(ratePaisePerBase, issuedQty);
  const costVariancePaise = actualCostPaise - plannedCostPaise;
  if (!Number.isSafeInteger(costVariancePaise)) {
    throw new RangeError('Cost variance exceeds the safe integer range');
  }
  return { plannedCostPaise, actualCostPaise, costVariancePaise };
}
