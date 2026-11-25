import Decimal from 'decimal.js';
import { fromBase } from './units.js';

function safeInteger(value, name) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer`);
  }
  return value;
}

function addSafe(left, right, name) {
  return safeInteger(left + right, name);
}

export function ratePerDisplayUnit(ratePaisePerBase, baseFactor) {
  let rate;
  try {
    rate = new Decimal(ratePaisePerBase);
  } catch {
    throw new TypeError('Rate must be a finite decimal value');
  }
  if (!rate.isFinite() || rate.isNegative()) {
    throw new RangeError('Rate must be a non-negative finite decimal value');
  }
  safeInteger(baseFactor, 'Display-unit base factor');
  if (baseFactor <= 0) {
    throw new RangeError('Display-unit base factor must be positive');
  }

  return rate
    .times(baseFactor)
    .div(100)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed();
}

export function aggregatePurchaseLines(lines) {
  if (!Array.isArray(lines)) {
    throw new TypeError('Purchase lines must be an array');
  }

  const suppliers = new Map();
  const items = new Map();
  for (const line of lines) {
    safeInteger(line.purchaseId, 'Purchase id');
    safeInteger(line.supplierId, 'Supplier id');
    safeInteger(line.itemId, 'Item id');
    safeInteger(line.qty, 'Purchase quantity');
    safeInteger(line.amountPaise, 'Purchase amount');
    safeInteger(line.baseFactor, 'Display-unit base factor');
    if (line.qty <= 0 || line.amountPaise < 0 || line.baseFactor <= 0) {
      throw new RangeError('Purchase line quantities, amounts, and unit factors are invalid');
    }

    let supplier = suppliers.get(line.supplierId);
    if (!supplier) {
      supplier = {
        id: line.supplierId,
        supplierName: line.supplierName,
        supplierGstin: line.supplierGstin,
        purchaseIds: new Set(),
        lines: 0,
        amountPaise: 0
      };
      suppliers.set(line.supplierId, supplier);
    }
    supplier.purchaseIds.add(line.purchaseId);
    supplier.lines = addSafe(supplier.lines, 1, 'Supplier line count');
    supplier.amountPaise = addSafe(
      supplier.amountPaise,
      line.amountPaise,
      'Supplier purchase amount'
    );

    let item = items.get(line.itemId);
    if (!item) {
      item = {
        id: line.itemId,
        itemCode: line.itemCode,
        itemName: line.itemName,
        unit: line.unit,
        baseFactor: line.baseFactor,
        qtyBase: 0,
        amountPaise: 0
      };
      items.set(line.itemId, item);
    }
    item.qtyBase = addSafe(item.qtyBase, line.qty, 'Item purchase quantity');
    item.amountPaise = addSafe(item.amountPaise, line.amountPaise, 'Item purchase amount');
  }

  const bySupplier = [...suppliers.values()]
    .sort((left, right) => left.supplierName.localeCompare(right.supplierName) ||
      left.id - right.id)
    .map((supplier) => ({
      supplierName: supplier.supplierName,
      supplierGstin: supplier.supplierGstin,
      purchases: safeInteger(supplier.purchaseIds.size, 'Supplier purchase count'),
      lines: supplier.lines,
      amountPaise: supplier.amountPaise
    }));

  const byItem = [...items.values()]
    .sort((left, right) => left.itemCode.localeCompare(right.itemCode) || left.id - right.id)
    .map((item) => ({
      itemCode: item.itemCode,
      itemName: item.itemName,
      unit: item.unit,
      qty: fromBase(item.qtyBase, item.unit).toFixed(),
      amountPaise: item.amountPaise,
      avgRatePerUnit: ratePerDisplayUnit(
        new Decimal(item.amountPaise).div(item.qtyBase).toString(),
        item.baseFactor
      )
    }));

  return { bySupplier, byItem };
}
