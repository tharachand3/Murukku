function assertSafeInteger(value, name) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
  return value;
}

export function effectiveQty(line) {
  return assertSafeInteger(line.approvedQty ?? line.qty, 'Quantity');
}

export function effectivePricePaise(line) {
  return assertSafeInteger(
    line.approvedPricePaise ?? line.pricePaise,
    'Price in paise'
  );
}

export function lineTaxablePaise(line) {
  const taxablePaise = effectiveQty(line) * effectivePricePaise(line);
  return assertSafeInteger(taxablePaise, 'Line taxable paise');
}

export function orderTaxablePaise(lines) {
  if (!Array.isArray(lines)) {
    throw new TypeError('Order lines must be an array');
  }
  return lines.reduce((total, line) => (
    assertSafeInteger(total + lineTaxablePaise(line), 'Order taxable paise')
  ), 0);
}
