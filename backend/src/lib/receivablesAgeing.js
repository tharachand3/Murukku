function assertPaise(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

function addSafe(total, amount, name) {
  assertPaise(amount, name);
  const result = total + amount;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${name} total exceeds the safe integer range`);
  }
  return result;
}

function calendarDayNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('Date must be a valid YYYY-MM-DD calendar day');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.toISOString().slice(0, 10) !== value) {
    throw new TypeError('Date must be a valid YYYY-MM-DD calendar day');
  }
  return date.getTime() / 86400000;
}

export function invoiceAgeDays(issueDate, asOfDate) {
  const days = calendarDayNumber(asOfDate) - calendarDayNumber(issueDate);
  if (days < 0) {
    throw new RangeError('Invoice issue date cannot be after the as-of date');
  }
  return days;
}

export function ageingBucket(ageDays) {
  if (!Number.isSafeInteger(ageDays) || ageDays < 0) {
    throw new TypeError('ageDays must be a non-negative safe integer');
  }
  if (ageDays <= 30) return '0-30';
  if (ageDays <= 60) return '31-60';
  if (ageDays <= 90) return '61-90';
  return '91+';
}

export function allocateReceivables({ invoices, payments, asOfDate }) {
  if (!Array.isArray(invoices) || !Array.isArray(payments)) {
    throw new TypeError('invoices and payments must be arrays');
  }
  calendarDayNumber(asOfDate);

  const customerInvoices = new Map();
  const invoiceById = new Map();
  for (const invoice of invoices) {
    if (!Number.isSafeInteger(invoice.id) || !Number.isSafeInteger(invoice.customerId)) {
      throw new TypeError('Invoice and customer ids must be safe integers');
    }
    assertPaise(invoice.totalPaise, 'invoice total');
    const ageDays = invoiceAgeDays(invoice.issueDate, asOfDate);
    const entry = {
      ...invoice,
      ageDays,
      bucket: ageingBucket(ageDays),
      linkedPaidPaise: 0
    };
    if (invoiceById.has(entry.id)) {
      throw new TypeError('Invoice ids must be unique');
    }
    invoiceById.set(entry.id, entry);
    if (!customerInvoices.has(entry.customerId)) {
      customerInvoices.set(entry.customerId, []);
    }
    customerInvoices.get(entry.customerId).push(entry);
  }

  const customerPayments = new Map();
  for (const payment of payments) {
    if (!Number.isSafeInteger(payment.customerId)) {
      throw new TypeError('Payment customer ids must be safe integers');
    }
    assertPaise(payment.amountPaise, 'payment amount');
    customerPayments.set(
      payment.customerId,
      addSafe(customerPayments.get(payment.customerId) ?? 0, payment.amountPaise, 'Customer payments')
    );
    const linkedInvoice = payment.invoiceId === null || payment.invoiceId === undefined
      ? null
      : invoiceById.get(payment.invoiceId);
    if (linkedInvoice && linkedInvoice.customerId === payment.customerId) {
      linkedInvoice.linkedPaidPaise = addSafe(
        linkedInvoice.linkedPaidPaise,
        payment.amountPaise,
        'Invoice payments'
      );
    }
  }

  const invoiceRows = [];
  const customerRows = [];
  for (const [customerId, rows] of customerInvoices) {
    rows.sort((left, right) => (
      left.issueDate.localeCompare(right.issueDate) || left.id - right.id
    ));

    let directlyAppliedPaise = 0;
    for (const invoice of rows) {
      directlyAppliedPaise = addSafe(
        directlyAppliedPaise,
        Math.min(invoice.totalPaise, invoice.linkedPaidPaise),
        'Applied invoice payments'
      );
    }
    let unallocatedPaise = (customerPayments.get(customerId) ?? 0) - directlyAppliedPaise;

    const allocatedInvoices = rows.map((invoice) => {
      const directPaidPaise = Math.min(invoice.totalPaise, invoice.linkedPaidPaise);
      const directDuePaise = invoice.totalPaise - directPaidPaise;
      const fifoAppliedPaise = Math.min(directDuePaise, unallocatedPaise);
      unallocatedPaise -= fifoAppliedPaise;
      const duePaise = directDuePaise - fifoAppliedPaise;
      const paidPaise = invoice.totalPaise - duePaise;
      const {
        linkedPaidPaise: _linkedPaidPaise,
        customer,
        ...invoiceRow
      } = invoice;
      const result = {
        ...invoiceRow,
        customerName: customer?.name ?? invoice.customerName,
        paidPaise,
        duePaise
      };
      invoiceRows.push(result);
      return result;
    });

    const summary = {
      customerId,
      customerName: rows[0].customer?.name ?? rows[0].customerName,
      customerType: rows[0].customer?.type ?? rows[0].customerType,
      bucket0To30Paise: 0,
      bucket31To60Paise: 0,
      bucket61To90Paise: 0,
      bucket91PlusPaise: 0,
      outstandingPaise: 0,
      creditPaise: unallocatedPaise
    };
    const bucketFields = {
      '0-30': 'bucket0To30Paise',
      '31-60': 'bucket31To60Paise',
      '61-90': 'bucket61To90Paise',
      '91+': 'bucket91PlusPaise'
    };
    for (const invoice of allocatedInvoices) {
      const field = bucketFields[invoice.bucket];
      summary[field] = addSafe(summary[field], invoice.duePaise, field);
      summary.outstandingPaise = addSafe(
        summary.outstandingPaise,
        invoice.duePaise,
        'Customer outstanding'
      );
    }
    customerRows.push(summary);
  }

  return { customers: customerRows, invoices: invoiceRows };
}
