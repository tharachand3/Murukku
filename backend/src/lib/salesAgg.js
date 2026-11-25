function assertSafeInteger(value, name) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer`);
  }
}

function addSafe(left, right, name) {
  const total = left + right;
  assertSafeInteger(total, name);
  return total;
}

export function roundRatioHalfUp(numerator, denominator, name = 'Average') {
  assertSafeInteger(numerator, `${name} numerator`);
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new TypeError(`${name} denominator must be a positive safe integer`);
  }

  const numeratorBig = BigInt(numerator);
  const denominatorBig = BigInt(denominator);
  const negative = numeratorBig < 0n;
  const absolute = negative ? -numeratorBig : numeratorBig;
  let quotient = absolute / denominatorBig;
  const remainder = absolute % denominatorBig;
  if (remainder * 2n >= denominatorBig) {
    quotient += 1n;
  }
  const rounded = negative ? -quotient : quotient;
  const result = Number(rounded);
  assertSafeInteger(result, `${name} result`);
  return result;
}

function assertArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }
}

function assertInvoice(invoice) {
  if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice)) {
    throw new TypeError('Each invoice must be an object');
  }
  for (const field of [
    'customerId',
    'taxableValuePaise',
    'cgstPaise',
    'sgstPaise',
    'igstPaise',
    'totalPaise',
    'qty'
  ]) {
    assertSafeInteger(invoice[field], field);
  }
  for (const field of [
    'customerName',
    'customerType',
    'stateName',
    'issueDate'
  ]) {
    if (typeof invoice[field] !== 'string') {
      throw new TypeError(`${field} must be a string`);
    }
  }
  if (invoice.customerGstin !== null && typeof invoice.customerGstin !== 'string') {
    throw new TypeError('customerGstin must be a string or null');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.issueDate)) {
    throw new TypeError('issueDate must use YYYY-MM-DD format');
  }
}

function assertLine(line) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) {
    throw new TypeError('Each invoice line must be an object');
  }
  for (const field of [
    'itemId',
    'invoiceId',
    'qty',
    'taxableValuePaise',
    'cgstPaise',
    'sgstPaise',
    'igstPaise',
    'totalPaise'
  ]) {
    assertSafeInteger(line[field], field);
  }
  for (const field of ['itemCode', 'itemName', 'unit']) {
    if (typeof line[field] !== 'string') {
      throw new TypeError(`${field} must be a string`);
    }
  }
  if (line.hsnCode !== null && typeof line.hsnCode !== 'string') {
    throw new TypeError('hsnCode must be a string or null');
  }
}

function safeTax(cgst, sgst, igst) {
  return addSafe(addSafe(cgst, sgst, 'Tax total'), igst, 'Tax total');
}

export function aggregateByCustomer(invoices) {
  assertArray(invoices, 'invoices');
  const customers = new Map();
  for (const invoice of invoices) {
    assertInvoice(invoice);
    let customer = customers.get(invoice.customerId);
    if (!customer) {
      customer = {
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        customerType: invoice.customerType,
        customerGstin: invoice.customerGstin,
        stateName: invoice.stateName,
        invoices: 0,
        qty: 0,
        taxableValuePaise: 0,
        taxPaise: 0,
        totalPaise: 0,
        lastInvoiceDate: invoice.issueDate
      };
      customers.set(invoice.customerId, customer);
    } else if (
      customer.customerName !== invoice.customerName ||
      customer.customerType !== invoice.customerType ||
      customer.customerGstin !== invoice.customerGstin ||
      customer.stateName !== invoice.stateName
    ) {
      throw new TypeError('Customer details must be consistent across invoices');
    }

    customer.invoices = addSafe(customer.invoices, 1, 'Invoice count');
    customer.qty = addSafe(customer.qty, invoice.qty, 'Customer quantity');
    customer.taxableValuePaise = addSafe(
      customer.taxableValuePaise,
      invoice.taxableValuePaise,
      'Customer taxable value'
    );
    customer.taxPaise = addSafe(
      customer.taxPaise,
      safeTax(invoice.cgstPaise, invoice.sgstPaise, invoice.igstPaise),
      'Customer tax'
    );
    customer.totalPaise = addSafe(
      customer.totalPaise,
      invoice.totalPaise,
      'Customer total'
    );
    if (invoice.issueDate > customer.lastInvoiceDate) {
      customer.lastInvoiceDate = invoice.issueDate;
    }
  }

  return [...customers.values()]
    .map((customer) => ({
      ...customer,
      avgInvoicePaise: roundRatioHalfUp(
        customer.totalPaise,
        customer.invoices,
        'Average invoice value'
      )
    }))
    .sort((left, right) =>
      right.totalPaise - left.totalPaise ||
      left.customerName.localeCompare(right.customerName)
    );
}

export function aggregateByProduct(lines) {
  assertArray(lines, 'lines');
  const products = new Map();
  for (const line of lines) {
    assertLine(line);
    let product = products.get(line.itemId);
    if (!product) {
      product = {
        itemId: line.itemId,
        itemCode: line.itemCode,
        itemName: line.itemName,
        hsnCode: line.hsnCode,
        unit: line.unit,
        invoiceIds: new Set(),
        qty: 0,
        taxableValuePaise: 0,
        taxPaise: 0,
        totalPaise: 0
      };
      products.set(line.itemId, product);
    }

    product.invoiceIds.add(line.invoiceId);
    product.qty = addSafe(product.qty, line.qty, 'Product quantity');
    product.taxableValuePaise = addSafe(
      product.taxableValuePaise,
      line.taxableValuePaise,
      'Product taxable value'
    );
    product.taxPaise = addSafe(
      product.taxPaise,
      safeTax(line.cgstPaise, line.sgstPaise, line.igstPaise),
      'Product tax'
    );
    product.totalPaise = addSafe(product.totalPaise, line.totalPaise, 'Product total');
  }

  return [...products.values()]
    .map((product) => ({
      itemId: product.itemId,
      itemCode: product.itemCode,
      itemName: product.itemName,
      hsnCode: product.hsnCode,
      unit: product.unit,
      invoices: product.invoiceIds.size,
      qty: product.qty,
      taxableValuePaise: product.taxableValuePaise,
      avgRatePaise: product.qty === 0
        ? 0
        : roundRatioHalfUp(product.taxableValuePaise, product.qty, 'Average rate'),
      taxPaise: product.taxPaise,
      totalPaise: product.totalPaise
    }))
    .sort((left, right) =>
      right.totalPaise - left.totalPaise ||
      left.itemName.localeCompare(right.itemName)
    );
}

export function shareBp(part, whole) {
  assertSafeInteger(part, 'Share part');
  assertSafeInteger(whole, 'Share whole');
  if (whole === 0) {
    return 0;
  }
  const scaledPart = BigInt(part) * 10000n;
  const wholeBig = BigInt(whole);
  const negative = (scaledPart < 0n) !== (wholeBig < 0n);
  const numerator = scaledPart < 0n ? -scaledPart : scaledPart;
  const denominator = wholeBig < 0n ? -wholeBig : wholeBig;
  let quotient = numerator / denominator;
  if ((numerator % denominator) * 2n >= denominator) {
    quotient += 1n;
  }
  const result = Number(negative ? -quotient : quotient);
  assertSafeInteger(result, 'Share basis points');
  return result;
}
