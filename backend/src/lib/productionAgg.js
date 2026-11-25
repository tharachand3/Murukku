import { mulRateQty } from './money.js';
import { varianceBp } from './variance.js';

function safeInteger(value, name) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer`);
  }
  return value;
}

function addSafe(left, right, name) {
  return safeInteger(left + right, name);
}

export function wastageByItem(lines) {
  if (!Array.isArray(lines)) {
    throw new TypeError('Production lines must be an array');
  }

  const grouped = new Map();
  for (const line of lines) {
    safeInteger(line.itemId, 'Item id');
    safeInteger(line.plannedQty, 'Planned quantity');
    safeInteger(line.issuedQty, 'Issued quantity');
    safeInteger(line.scrapQty, 'Scrap quantity');
    safeInteger(line.baseFactor, 'Display-unit base factor');
    if (
      line.plannedQty < 0 ||
      line.issuedQty < 0 ||
      line.scrapQty < 0 ||
      line.baseFactor <= 0
    ) {
      throw new RangeError('Production quantities and unit factors are invalid');
    }

    const excessBase = Math.max(0, line.issuedQty - line.plannedQty);
    const scrapValuePaise = mulRateQty(line.ratePaisePerBase, line.scrapQty);
    const excessValuePaise = mulRateQty(line.ratePaisePerBase, excessBase);
    let row = grouped.get(line.itemId);
    if (!row) {
      row = {
        itemId: line.itemId,
        itemCode: line.itemCode,
        itemName: line.itemName,
        unit: line.unit,
        scrapBase: 0,
        scrapValuePaise: 0,
        excessBase: 0,
        excessValuePaise: 0
      };
      grouped.set(line.itemId, row);
    }
    row.scrapBase = addSafe(row.scrapBase, line.scrapQty, 'Scrap quantity total');
    row.scrapValuePaise = addSafe(
      row.scrapValuePaise,
      scrapValuePaise,
      'Scrap value total'
    );
    row.excessBase = addSafe(row.excessBase, excessBase, 'Excess quantity total');
    row.excessValuePaise = addSafe(
      row.excessValuePaise,
      excessValuePaise,
      'Excess value total'
    );
  }

  return [...grouped.values()].sort((left, right) => {
    const leftValue = addSafe(
      left.scrapValuePaise,
      left.excessValuePaise,
      'Combined wastage value'
    );
    const rightValue = addSafe(
      right.scrapValuePaise,
      right.excessValuePaise,
      'Combined wastage value'
    );
    return rightValue - leftValue || left.itemCode.localeCompare(right.itemCode);
  });
}

export function yieldByProduct(runs) {
  if (!Array.isArray(runs)) {
    throw new TypeError('Production runs must be an array');
  }

  const grouped = new Map();
  for (const run of runs) {
    safeInteger(run.productId, 'Product id');
    safeInteger(run.plannedOutputQty, 'Planned output');
    safeInteger(run.actualGoodQty, 'Good output');
    if (run.plannedOutputQty <= 0 || run.actualGoodQty < 0) {
      throw new RangeError('Production outputs are invalid');
    }

    let row = grouped.get(run.productId);
    if (!row) {
      row = {
        productId: run.productId,
        productCode: run.productCode,
        productName: run.productName,
        runs: 0,
        plannedOutput: 0,
        goodOutput: 0,
        shortfall: 0
      };
      grouped.set(run.productId, row);
    }
    row.runs = addSafe(row.runs, 1, 'Product run count');
    row.plannedOutput = addSafe(
      row.plannedOutput,
      run.plannedOutputQty,
      'Planned output total'
    );
    row.goodOutput = addSafe(row.goodOutput, run.actualGoodQty, 'Good output total');
    row.shortfall = addSafe(
      row.shortfall,
      Math.max(0, run.plannedOutputQty - run.actualGoodQty),
      'Output shortfall total'
    );
  }

  return [...grouped.values()]
    .map((row) => ({
      ...row,
      shortfallBp: varianceBp(row.plannedOutput, row.goodOutput)
    }))
    .sort((left, right) => left.productCode.localeCompare(right.productCode));
}
