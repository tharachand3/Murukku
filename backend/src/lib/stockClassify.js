const IN_COLUMNS = Object.freeze([
  'openingEntries',
  'purchases',
  'productionIn',
  'returnsIn',
  'adjustmentsIn'
]);

const OUT_COLUMNS = Object.freeze([
  'productionOut',
  'scrapOut',
  'dispatchOut',
  'adjustmentsOut'
]);

function assertSafeInteger(value, name) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer`);
  }
}

function fallback(qtyChange) {
  return {
    column: qtyChange > 0 ? 'adjustmentsIn' : 'adjustmentsOut',
    unclassified: true
  };
}

export function classifyMovement(movementType, qtyChange) {
  assertSafeInteger(qtyChange, 'qtyChange');
  if (movementType === 'ADJUSTMENT') {
    return {
      column: qtyChange > 0 ? 'adjustmentsIn' : 'adjustmentsOut',
      unclassified: false
    };
  }

  const expected = {
    OPENING: ['openingEntries', qtyChange > 0],
    PURCHASE: ['purchases', qtyChange > 0],
    PRODUCTION_OUTPUT: ['productionIn', qtyChange > 0],
    SALES_RETURN: ['returnsIn', qtyChange > 0],
    PRODUCTION_ISSUE: ['productionOut', qtyChange < 0],
    PRODUCTION_SCRAP: ['scrapOut', qtyChange < 0],
    DISPATCH: ['dispatchOut', qtyChange < 0]
  }[movementType];

  if (expected?.[1]) {
    return { column: expected[0], unclassified: false };
  }
  return fallback(qtyChange);
}

export function reconcile({ opening, movements, closing }) {
  assertSafeInteger(opening, 'opening');
  assertSafeInteger(closing, 'closing');
  if (!movements || typeof movements !== 'object' || Array.isArray(movements)) {
    throw new TypeError('movements must be an object');
  }

  let expectedClosing = opening;
  for (const column of IN_COLUMNS) {
    const quantity = movements[column] ?? 0;
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new TypeError(`${column} must be a non-negative safe integer`);
    }
    expectedClosing += quantity;
    assertSafeInteger(expectedClosing, 'reconciled balance');
  }
  for (const column of OUT_COLUMNS) {
    const quantity = movements[column] ?? 0;
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new TypeError(`${column} must be a non-negative safe integer`);
    }
    expectedClosing -= quantity;
    assertSafeInteger(expectedClosing, 'reconciled balance');
  }
  return expectedClosing === closing;
}
