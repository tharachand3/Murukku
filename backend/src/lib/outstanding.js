function assertPaise(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

export function customerBalance({ postedInvoicesPaise, paymentsPaise }) {
  assertPaise(postedInvoicesPaise, 'postedInvoicesPaise');
  assertPaise(paymentsPaise, 'paymentsPaise');
  const difference = postedInvoicesPaise - paymentsPaise;
  if (!Number.isSafeInteger(difference)) {
    throw new RangeError('Customer balance exceeds the safe integer range');
  }
  return {
    outstandingPaise: Math.max(0, difference),
    creditPaise: Math.max(0, -difference)
  };
}

export function invoiceStatus(totalPaise, paidPaise) {
  assertPaise(totalPaise, 'totalPaise');
  assertPaise(paidPaise, 'paidPaise');
  if (paidPaise >= totalPaise) {
    return 'PAID';
  }
  return paidPaise === 0 ? 'UNPAID' : 'PARTIAL';
}
