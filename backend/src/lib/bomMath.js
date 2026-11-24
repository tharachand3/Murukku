import Decimal from 'decimal.js';

const BomDecimal = Decimal.clone({ precision: 40 });
const MAX_BATCH_COUNT = new BomDecimal(100);
const MAX_POSTGRES_INT = 2147483647;

function parseDecimal(value, name) {
  let decimal;
  try {
    decimal = new BomDecimal(value);
  } catch {
    throw new RangeError(`${name} must be a finite decimal value`);
  }
  if (!decimal.isFinite()) {
    throw new RangeError(`${name} must be a finite decimal value`);
  }
  return decimal;
}

function validateBom(bom) {
  if (
    !bom ||
    typeof bom !== 'object' ||
    !Number.isSafeInteger(bom.batchYieldQty) ||
    bom.batchYieldQty <= 0 ||
    !Array.isArray(bom.lines)
  ) {
    throw new RangeError('BOM must have a positive batch yield and lines');
  }
  for (const line of bom.lines) {
    if (
      !line ||
      typeof line !== 'object' ||
      !Number.isSafeInteger(line.itemId) ||
      line.itemId <= 0 ||
      !Number.isSafeInteger(line.qtyPerBatch) ||
      line.qtyPerBatch <= 0
    ) {
      throw new RangeError('BOM lines must have positive integer itemId and qtyPerBatch values');
    }
  }
}

function normalizeBatchCount(value) {
  const parsed = parseDecimal(value, 'batchCount');
  if (parsed.lte(0) || parsed.gt(MAX_BATCH_COUNT)) {
    throw new RangeError('batchCount must be greater than 0 and no more than 100');
  }
  const batchCount = parsed.toDecimalPlaces(4, BomDecimal.ROUND_HALF_UP);
  if (batchCount.lte(0)) {
    throw new RangeError('batchCount must be greater than 0 and no more than 100');
  }
  return batchCount;
}

function roundedInteger(value, name) {
  const rounded = value.toDecimalPlaces(0, BomDecimal.ROUND_HALF_UP);
  if (rounded.lt(0) || rounded.gt(MAX_POSTGRES_INT)) {
    throw new RangeError(`${name} exceeds the supported integer range`);
  }
  return rounded.toNumber();
}

function plan(bom, batchCount) {
  validateBom(bom);
  const count = normalizeBatchCount(batchCount);
  return {
    batchCount: count,
    plannedOutputQty: roundedInteger(
      new BomDecimal(bom.batchYieldQty).times(count),
      'plannedOutputQty'
    ),
    lines: bom.lines.map((line) => ({
      itemId: line.itemId,
      plannedQty: roundedInteger(
        new BomDecimal(line.qtyPerBatch).times(count),
        `plannedQty for item ${line.itemId}`
      )
    }))
  };
}

export function planFromBatches(bom, batchCount) {
  return plan(bom, batchCount);
}

export function planFromTargetOutput(bom, targetPackets) {
  validateBom(bom);
  if (!Number.isSafeInteger(targetPackets) || targetPackets <= 0) {
    throw new RangeError('targetPackets must be a positive safe integer');
  }
  const batchCount = new BomDecimal(targetPackets)
    .div(bom.batchYieldQty)
    .toDecimalPlaces(4, BomDecimal.ROUND_HALF_UP);
  return plan(bom, batchCount);
}

export function batchesFromIssue(bom, itemId, issuedQty) {
  validateBom(bom);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw new RangeError('itemId must be a positive safe integer');
  }
  if (!Number.isSafeInteger(issuedQty) || issuedQty <= 0) {
    throw new RangeError('issuedQty must be a positive safe integer');
  }
  const line = bom.lines.find((candidate) => candidate.itemId === itemId);
  if (!line) {
    throw new RangeError(`Item ${itemId} is not in the BOM`);
  }
  const batchCount = new BomDecimal(issuedQty)
    .div(line.qtyPerBatch)
    .toDecimalPlaces(4, BomDecimal.ROUND_HALF_UP);
  return plan(bom, batchCount);
}
