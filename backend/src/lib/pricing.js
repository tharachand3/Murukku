function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function pickPrice({ customerPricePaise, defaultPricePaise }) {
  if (isPositiveInteger(customerPricePaise)) {
    return { pricePaise: customerPricePaise, source: 'CUSTOMER' };
  }
  if (isPositiveInteger(defaultPricePaise)) {
    return { pricePaise: defaultPricePaise, source: 'DEFAULT' };
  }
  return null;
}
