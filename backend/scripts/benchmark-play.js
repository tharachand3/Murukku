import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { formatCell } from '../src/lib/exportFormat.js';

const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const PRODUCTION_EMAIL = 'production@demo.com';
const ACCOUNTANT_EMAIL = 'accountant@demo.com';
const PRODUCTION_PASSWORD = 'Demo@123';
const ADMIN_EMAIL = 'admin@demo.com';
const SALESMAN_A_EMAIL = 'salesman.a@demo.com';
const SALESMAN_B_EMAIL = 'salesman.b@demo.com';

async function api(path, { token, method = 'GET', body, expectedStatus = 200 } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let responseBody;
  try {
    responseBody = text ? JSON.parse(text) : null;
  } catch {
    responseBody = text;
  }
  if (!response.ok && response.status !== expectedStatus) {
    throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(responseBody)}`);
  }
  return responseBody;
}

async function login() {
  const result = await api('/api/auth/login', {
    method: 'POST',
    body: { email: PRODUCTION_EMAIL, password: PRODUCTION_PASSWORD }
  });
  if (typeof result?.token !== 'string') {
    throw new Error('Production login did not return a token');
  }
  return result.token;
}

async function loginUser(email) {
  const result = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password: PRODUCTION_PASSWORD }
  });
  if (typeof result?.token !== 'string') {
    throw new Error(`Login did not return a token for ${email}`);
  }
  return result.token;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function reportSection(result, reportKey, sectionKey) {
  const section = result.sections?.find((entry) => entry.key === sectionKey);
  if (!section) {
    throw new Error(`${reportKey} is missing the ${sectionKey} section`);
  }
  return section;
}

function assertReportBenchmark(reportKey, result) {
  switch (reportKey) {
    case 'sales-register': {
      const invoices = reportSection(result, reportKey, 'invoices').rows;
      const summary = reportSection(result, reportKey, 'summary').rows;
      assertEqual(invoices.length, 1, 'Sales register invoice count');
      if (!/^INV\/\d{4}-\d{2}\/0001$/.test(invoices[0].invoiceNo)) {
        throw new Error(`Unexpected benchmark invoice number ${invoices[0].invoiceNo}`);
      }
      assertEqual(invoices[0].totalPaise, 787500, 'Sales register invoice total');
      assertEqual(
        summary.find(({ label }) => label === 'Net sales (posted invoices)')?.totalPaise,
        787500,
        'Sales register net sales'
      );
      return `${invoices[0].invoiceNo} total 787500 paise`;
    }
    case 'gst-summary': {
      const totals = reportSection(result, reportKey, 'gstr3b-outward').totals;
      assertEqual(totals.taxableValuePaise, 750000, 'GST net taxable value');
      assertEqual(totals.cgstPaise, 18750, 'GST CGST');
      assertEqual(totals.sgstPaise, 18750, 'GST SGST');
      assertEqual(totals.igstPaise, 0, 'GST IGST');
      return 'net taxable 750000; CGST 18750; SGST 18750; IGST 0 paise';
    }
    case 'receivables-ageing': {
      const row = reportSection(result, reportKey, 'customers').rows
        .find((entry) => entry.customerName === 'Retailer A');
      assertEqual(row?.outstandingPaise, 387500, 'Retailer A outstanding');
      assertEqual(row?.bucket0To30Paise, 387500, 'Retailer A 0-30 bucket');
      return 'Retailer A outstanding 387500 paise in 0-30 days';
    }
    case 'stock-summary': {
      const rows = reportSection(result, reportKey, 'items').rows;
      const flour = rows.find(({ itemCode }) => itemCode === 'FLOUR');
      const finished = rows.find(({ itemCode }) => itemCode === 'MURUKKU200');
      assertEqual(flour?.closingQty, '120', 'Stock report flour closing quantity');
      assertEqual(finished?.closingQty, '88', 'Stock report finished closing quantity');
      return 'FLOUR 120 kg; MURUKKU200 88 packets';
    }
    case 'purchase-register': {
      const lines = reportSection(result, reportKey, 'lines').rows;
      assertEqual(lines.length, 1, 'Purchase register line count');
      assertEqual(lines[0].amountPaise, 270000, 'Purchase register amount');
      return 'one purchase line; 270000 paise';
    }
    case 'production-report': {
      const runs = reportSection(result, reportKey, 'runs').rows;
      assertEqual(runs.length, 1, 'Production report completed run count');
      assertEqual(runs[0].status, 'COMPLETED', 'Production report run status');
      assertEqual(runs[0].yieldVarianceBp, -600, 'Production report yield variance');
      assertEqual(runs[0].yieldFlagged, 'YES', 'Production report yield flag');
      return 'one completed run; yield -600 bp flagged';
    }
    case 'sales-by-customer': {
      const retailer = reportSection(result, reportKey, 'customers').rows
        .find((entry) => entry.customerName === 'Retailer A');
      assertEqual(retailer?.qty, 150, 'Retailer A packets');
      assertEqual(retailer?.taxableValuePaise, 750000, 'Retailer A taxable sales');
      return 'Retailer A 150 packets; taxable sales 750000 paise';
    }
    case 'sales-by-product': {
      const product = reportSection(result, reportKey, 'products').rows
        .find((entry) => entry.itemCode === 'MURUKKU200');
      assertEqual(product?.qty, 150, 'Murukku packets sold');
      assertEqual(product?.taxableValuePaise, 750000, 'Product taxable sales');
      assertEqual(product?.totalPaise, 787500, 'Product sales including tax');
      return 'MURUKKU200 150 packets; total 787500 paise';
    }
    case 'stock-ledger': {
      const movements = reportSection(result, reportKey, 'movements').rows;
      const balances = reportSection(result, reportKey, 'balances').rows;
      const finished = balances.find((entry) => entry.itemCode === 'MURUKKU200');
      assertEqual(movements.length, 15, 'Stock ledger movement count');
      assertEqual(balances.length, 6, 'Stock ledger item count');
      assertEqual(finished?.closingQty, '88', 'Stock ledger finished balance');
      return '15 movements; 6 item balances; MURUKKU200 88 packets';
    }
    case 'product-costing': {
      const product = reportSection(result, reportKey, 'products').rows
        .find((entry) => entry.productCode === 'MURUKKU200');
      assertEqual(product?.runs, 1, 'Product costing completed runs');
      assertEqual(product?.materialCostPaise, 405500, 'Product material cost');
      assertEqual(product?.overheadCostPaise, 180000, 'Product overhead cost');
      assertEqual(product?.avgCostPerPacketPaise, '3114.3617', 'Product packet cost');
      assertEqual(product?.marginPctBp, 3771, 'Product margin basis points');
      return 'MURUKKU200 1 run; 3114.3617 paise/packet; margin 3771 bp';
    }
    default: {
      const firstSection = result.sections?.[0];
      if (!firstSection) {
        throw new Error(`${reportKey} did not return a section`);
      }
      return `${firstSection.rows.length} rows`;
    }
  }
}

async function validateReportExports(report, result, token) {
  const errors = [];
  const resultSections = result?.sections ?? [];
  const sections = resultSections.length > 0
    ? resultSections
    : report.sections ?? [];
  const formats = report.exportFormats;
  if (!Array.isArray(formats) || formats.length === 0) {
    errors.push('catalog has no export formats');
    return errors;
  }

  const contentTypes = {
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pdf: 'application/pdf'
  };
  for (const format of formats) {
    const csvSections = format === 'csv' && sections.length > 1
      ? sections
      : [{ key: undefined }];
    for (const { key } of csvSections) {
      const query = new URLSearchParams({ format });
      if (key) query.set('section', key);
      const label = `${format}${key ? ` (${key})` : ''}`;
      try {
        const response = await fetch(
          `${API_URL}/api/reports/${report.key}/export?${query}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        const expectedContentType = contentTypes[format];
        if (!expectedContentType) {
          throw new Error(`unsupported catalog export format ${format}`);
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.startsWith(expectedContentType)) {
          throw new Error(`unexpected Content-Type ${contentType}`);
        }
        const body = Buffer.from(await response.arrayBuffer());
        if (body.length === 0) {
          throw new Error('empty response body');
        }
        if (format === 'xlsx' && body.subarray(0, 2).toString('ascii') !== 'PK') {
          throw new Error('XLSX body does not start with PK');
        }
        if (format === 'pdf' && body.subarray(0, 4).toString('ascii') !== '%PDF') {
          throw new Error('PDF body does not start with %PDF');
        }
        if (format === 'csv') {
          const csv = body.toString('utf8').replace(/^\uFEFF/, '');
          const header = csv.split(/\r?\n/, 1)[0];
          const section = key
            ? resultSections.find((entry) => entry.key === key)
            : resultSections[0];
          const expectedHeader = section?.columns?.[0]?.label;
          if (!header || !expectedHeader || !header.includes(expectedHeader)) {
            throw new Error('CSV header row is missing or does not match the section');
          }
        }
      } catch (error) {
        errors.push(`${label}: ${error.message}`);
      }
    }
  }
  return errors;
}

const steps = [
  async ({ token, items, supplier }) => {
    const purchase = await api('/api/purchases', {
      token,
      method: 'POST',
      body: {
        supplierId: supplier.id,
        lines: [{
          itemId: items.FLOUR.id,
          qty: '60',
          unit: 'kg',
          ratePerUnitRupees: '45'
        }]
      }
    });
    assertEqual(purchase.totalPaise, 270000, 'Purchase amount in paise');
    const stock = await api('/api/stock/summary', { token });
    const flour = stock.find(({ code }) => code === 'FLOUR');
    assertEqual(flour?.balanceBase, 160000, 'Flour after purchase in grams');
    console.log(`Step 1 PASS: ${purchase.number}; flour ${flour.balanceDisplay}; amount ${purchase.totalDisplay}`);
  },
  async ({ token, items }) => {
    const run = await api('/api/production/runs', {
      token,
      method: 'POST',
      body: {
        finishedItemId: items.MURUKKU200.id,
        batchCount: '1',
        issues: [
          { itemId: items.FLOUR.id, qty: '40', unit: 'kg' },
          { itemId: items.OIL.id, qty: '10.5', unit: 'l' },
          { itemId: items.SPICE.id, qty: '1.2', unit: 'kg' }
        ]
      }
    });
    assertEqual(run.status, 'ISSUED', 'Run status after issue');
    const stock = await api('/api/stock/summary', { token });
    const balances = Object.fromEntries(stock.map((item) => [item.code, item.balanceDisplay]));
    assertEqual(balances.FLOUR, '120 kg', 'Flour after issue');
    assertEqual(balances.OIL, '19.5 l', 'Oil after issue');
    assertEqual(balances.SPICE, '3.8 kg', 'Spice after issue');
    console.log(`Step 2 PASS: ${run.runNo}; flour ${balances.FLOUR}, oil ${balances.OIL}, spice ${balances.SPICE}`);
    return { run };
  },
  async ({ token, items, run }) => {
    const completed = await api(`/api/production/runs/${run.id}/complete`, {
      token,
      method: 'POST',
      body: {
        actualGoodQty: 188,
        consumption: [
          { itemId: items.POUCH200.id, qty: '188', unit: 'pcs', scrapQty: '6' },
          { itemId: items.CARTON.id, qty: '9', unit: 'pcs' }
        ]
      }
    });
    assertEqual(completed.status, 'COMPLETED', 'Run status after completion');
    assertEqual(completed.materialCostPaise, 405500, 'Run material cost in paise');
    const stock = await api('/api/stock/summary', { token });
    const balances = Object.fromEntries(stock.map((item) => [item.code, item.balanceDisplay]));
    assertEqual(balances.POUCH200, '306 pcs', 'Pouches after completion');
    assertEqual(balances.CARTON, '21 pcs', 'Cartons after completion');
    assertEqual(balances.MURUKKU200, '238 packet', 'Finished goods after completion');
    console.log(`Step 3 PASS: ${run.runNo}; good 188; material cost ${completed.materialCostPaise} paise; finished ${balances.MURUKKU200}`);
  }
];

steps.push(
  async ({ salesmanA, admin, items, customers }) => {
    const orderResult = await api('/api/orders', {
      token: salesmanA,
      method: 'POST',
      body: {
        clientRef: 'benchmark-retailer-a-0001',
        customerId: customers.retailerA.id,
        lines: [{ itemId: items.MURUKKU200.id, qty: 150 }]
      }
    });
    const order = orderResult.order;
    assertEqual(order.status, 'SUBMITTED', 'Retailer A order status');
    assertEqual(order.lines[0].pricePaise, 5000, 'Retailer A packet price in paise');
    assertEqual(order.taxableTotalPaise, 750000, 'Retailer A taxable order in paise');
    const stock = await api('/api/stock/summary', { token: admin });
    const finished = stock.find(({ code }) => code === 'MURUKKU200');
    assertEqual(finished?.balanceBase, 238, 'Finished stock after order submission');
    console.log(`Step 4 PASS: ${order.orderNo}; 150 packets; taxable 750000 paise; FG ${finished.balanceBase}`);
    return { retailerOrder: order };
  },
  async ({ admin, items, retailerOrder }) => {
    await api(`/api/orders/${retailerOrder.id}/approve`, {
      token: admin,
      method: 'POST',
      body: {}
    });
    const invoice = await api('/api/invoices', {
      token: admin,
      method: 'POST',
      body: { orderId: retailerOrder.id }
    });
    assertEqual(invoice.totalPaise, 787500, 'Retailer A invoice total in paise');
    assertEqual(invoice.cgstPaise, 18750, 'Retailer A CGST in paise');
    assertEqual(invoice.sgstPaise, 18750, 'Retailer A SGST in paise');
    const beforeDispatch = await api('/api/stock/summary', { token: admin });
    const fgBefore = beforeDispatch.find(({ code }) => code === 'MURUKKU200')?.balanceBase;
    const dispatch = await api('/api/dispatches', {
      token: admin,
      method: 'POST',
      body: { invoiceId: invoice.id }
    });
    const afterDispatch = await api('/api/stock/summary', { token: admin });
    const fgAfter = afterDispatch.find(({ code }) => code === 'MURUKKU200')?.balanceBase;
    assertEqual(fgBefore, 238, 'Finished stock before dispatch');
    assertEqual(fgAfter, 88, 'Finished stock after dispatch');
    console.log(`Step 5 PASS: ${invoice.invoiceNo}; invoice 787500 paise; FG ${fgBefore} -> ${fgAfter}; ${dispatch.dispatch.dispatchNo}`);
    return { invoice, dispatch };
  },
  async ({ salesmanB, admin, items, customers }) => {
    const orderResult = await api('/api/orders', {
      token: salesmanB,
      method: 'POST',
      body: {
        clientRef: 'benchmark-distributor-b-0001',
        customerId: customers.distributorB.id,
        lines: [{ itemId: items.MURUKKU200.id, qty: 120 }]
      }
    });
    const order = orderResult.order;
    const [availability, preview] = await Promise.all([
      api(`/api/orders/${order.id}/availability`, { token: admin }),
      api(`/api/orders/${order.id}/invoice-preview`, { token: admin })
    ]);
    assertEqual(availability.totalShortPackets, 32, 'Distributor B shortage');
    assertEqual(availability.lines[0].free, 88, 'Distributor B free packets');
    assertEqual(preview.totals.taxableValuePaise, 600000, 'Distributor B taxable preview');
    assertEqual(preview.totals.igstPaise, 30000, 'Distributor B IGST preview');
    assertEqual(preview.totals.totalPaise, 630000, 'Distributor B invoice preview');
    const shortages = await api('/api/orders/shortages', { token: admin });
    assertEqual(shortages.totalShortPackets, 32, 'Shortage list total');
    const approval = await api(`/api/orders/${order.id}/approve`, {
      token: admin,
      method: 'POST',
      body: {},
      expectedStatus: 409
    });
    assertEqual(approval.error.code, 'INSUFFICIENT_STOCK', 'Full Distributor B approval');
    console.log(`Step 6 PASS: ${availability.message}; IGST ${preview.totals.igstPaise} paise; full approval refused`);
    return { distributorOrder: order };
  },
  async ({ admin, invoice, customers }) => {
    const paymentResult = await api('/api/payments', {
      token: admin,
      method: 'POST',
      body: {
        customerId: customers.retailerA.id,
        invoiceId: invoice.id,
        amountPaise: 400000,
        mode: 'UPI',
        reference: 'UPI123456'
      }
    });
    const payment = paymentResult.payment;
    const [retailer, distributor] = await Promise.all([
      api(`/api/payments/outstanding/${customers.retailerA.id}`, { token: admin }),
      api(`/api/payments/outstanding/${customers.distributorB.id}`, { token: admin })
    ]);
    assertEqual(retailer.outstandingPaise, 387500, 'Retailer A outstanding');
    assertEqual(distributor.outstandingPaise, 0, 'Distributor B outstanding');
    assertEqual(retailer.invoices[0].status, 'PARTIAL', 'Retailer A invoice status');
    console.log(`Step 7 PASS: ${payment.receiptNo}; outstanding ${retailer.outstandingPaise} paise; Distributor B owes ${distributor.outstandingPaise}`);
    console.log('Final proof: invoice Rs 7,875, outstanding Rs 3,875, Distributor B short by 32.');
  }
);

steps.push(async ({ token, run }) => {
  const labour = await api(`/api/production/runs/${run.id}/overheads`, {
    token,
    method: 'POST',
    body: { kind: 'LABOUR', amountPaise: 120000, note: 'Benchmark labour' }
  });
  assertEqual(labour.cost.overheadCostPaise, 120000, 'Labour overhead total');
  const power = await api(`/api/production/runs/${run.id}/overheads`, {
    token,
    method: 'POST',
    body: { kind: 'POWER_GAS', amountPaise: 60000, note: 'Benchmark gas and power' }
  });
  assertEqual(power.cost.overheadCostPaise, 180000, 'Total production overhead');
  assertEqual(power.cost.totalCostPaise, 585500, 'Total run cost in paise');
  assertEqual(power.cost.costPerPacketDisplay, 'Rs 31.14', 'Cost per good packet');
  console.log(
    `Step 8 PASS: materials ${power.cost.materialCostPaise}; overheads ${power.cost.overheadCostPaise}; total ${power.cost.totalCostPaise}; cost per packet ${power.cost.costPerPacketDisplay}`
  );
});

steps.push(async ({ token: production, accountant, admin }) => {
  const accountantCatalog = await api('/api/reports', { token: accountant });
  if (!Array.isArray(accountantCatalog)) {
    throw new Error('Accountant report catalog did not return a list');
  }
  const catalog = await api('/api/reports', { token: admin });
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new Error('Report catalog is empty');
  }
  const outputDirectory = new URL('../exports/benchmark/', import.meta.url);
  await mkdir(outputDirectory, { recursive: true });
  const reportTokens = {
    'production:read': production,
    'stock:read': production,
    'purchases:read': production,
    'costing:read': accountant,
    'payments:read': accountant,
    'reports:read': accountant
  };

  for (const report of catalog) {
    const token = reportTokens[report.capability] ?? admin;
    const result = await api(`/api/reports/${report.key}`, { token });
    const firstSection = result.sections?.[0];
    if (!firstSection) {
      throw new Error(`Report ${report.key} did not return a section`);
    }
    const headlineValues = firstSection.totals ?? firstSection.rows?.[0] ?? {};
    const headlineEntry = report.key === 'product-costing'
      ? (() => {
          const product = firstSection.rows.find(({ productCode }) => (
            productCode === 'MURUKKU200'
          )) ?? firstSection.rows[0];
          return product?.avgCostPerPacketPaise === null ||
            product?.avgCostPerPacketPaise === undefined
            ? undefined
            : ['avgCostPerPacketPaise', formatCell(product.avgCostPerPacketPaise, 'moneyDecimal')];
        })()
      : Object.entries(headlineValues)
        .sort(([left], [right]) => (
          Number(/total/i.test(right)) - Number(/total/i.test(left))
        ))
        .find(([key, value]) => /Paise|total|amount|cost|margin/i.test(key) &&
          value !== null && value !== undefined);
    console.log(
      `${report.key}: ${firstSection.rows.length} rows; ` +
      `${headlineEntry ? `${headlineEntry[0]}=${headlineEntry[1]}` : 'no total'}`
    );
    for (const format of ['csv', 'xlsx', 'pdf']) {
      const response = await fetch(
        `${API_URL}/api/reports/${report.key}/export?format=${format}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`${report.key} ${format} export failed (${response.status}): ${detail}`);
      }
      const fileUrl = new URL(`${report.key}.${format}`, outputDirectory);
      await writeFile(fileUrl, Buffer.from(await response.arrayBuffer()));
      console.log(`  ${fileURLToPath(fileUrl)}`);
    }
  }
  console.log('Step 9 PASS: all registered reports exported as CSV, XLSX, and PDF.');

  const failures = [];
  const reportResults = new Map();
  for (const report of accountantCatalog) {
    const errors = [];
    let result;
    let summary = 'report output unavailable';
    try {
      result = await api(`/api/reports/${report.key}`, { token: accountant });
      if (!Array.isArray(result.sections) || result.sections.length === 0) {
        throw new Error('report returned no sections');
      }
      reportResults.set(report.key, result);
      summary = assertReportBenchmark(report.key, result);
    } catch (error) {
      errors.push(error.message);
    }
    errors.push(...await validateReportExports(report, result, accountant));
    if (errors.length > 0) {
      failures.push(report.key);
      console.error(`Report ${report.key} FAIL: ${[...new Set(errors)].join('; ')}`);
    } else {
      console.log(`Report ${report.key} PASS: ${summary}`);
    }
  }

  try {
    const [invoiceList, runList] = await Promise.all([
      api('/api/invoices?status=POSTED&page=1&limit=100', { token: accountant }),
      api('/api/production/runs?page=1&limit=100', { token: production })
    ]);
    const invoiceNo = reportResults.get('sales-register')
      ?.sections.find(({ key }) => key === 'invoices')?.rows[0]?.invoiceNo;
    const invoice = invoiceList.items?.find((entry) => entry.invoiceNo === invoiceNo);
    const run = runList.items?.find((entry) =>
      entry.status === 'COMPLETED' && entry.actualGoodQtyBase === 188
    );
    if (!invoice || !run) {
      throw new Error('Could not find the benchmark invoice and completed run');
    }

    const pdfResponse = await fetch(
      `${API_URL}/api/invoices/${invoice.id}/pdf`,
      { headers: { Authorization: `Bearer ${accountant}` } }
    );
    const pdf = Buffer.from(await pdfResponse.arrayBuffer());
    if (!pdfResponse.ok ||
        !(pdfResponse.headers.get('content-type') ?? '').startsWith('application/pdf') ||
        pdf.subarray(0, 4).toString('ascii') !== '%PDF') {
      throw new Error(`Invoice PDF failed validation (HTTP ${pdfResponse.status})`);
    }
    console.log(`Invoice PDF PASS: ${invoice.invoiceNo}`);

    const costSheet = await api(`/api/costing/runs/${run.id}/sheet`, { token: accountant });
    assertEqual(costSheet.perPacket?.totalPaise, '3114.3617', 'Cost per packet in paise');
    assertEqual(costSheet.perPacket?.display, 'Rs 31.14', 'Cost per packet display');
    assertEqual(costSheet.margin?.bp, 3771, 'Cost sheet margin basis points');
    console.log('Costing sheet PASS: 3114.3617 paise per packet; margin 3771 bp');
  } catch (error) {
    failures.push('invoice-pdf-or-costing-sheet');
    console.error(`Invoice PDF / costing sheet FAIL: ${error.message}`);
  }
  if (failures.length > 0) {
    throw new Error(`Step 9 validation failed: ${[...new Set(failures)].join(', ')}`);
  }
});

function readUpto(args) {
  const option = args.find((argument) => argument.startsWith('--upto='));
  if (!option) {
    return steps.length;
  }
  const upto = Number(option.slice('--upto='.length));
  if (!Number.isSafeInteger(upto) || upto < 1 || upto > steps.length) {
    throw new Error(`Use --upto=1 through --upto=${steps.length}`);
  }
  return upto;
}

async function main() {
  let upto;
  try {
    upto = readUpto(process.argv.slice(2));
    const [token, salesmanA, admin, salesmanB, accountant] = await Promise.all([
      login(),
      loginUser(SALESMAN_A_EMAIL),
      loginUser(ADMIN_EMAIL),
      loginUser(SALESMAN_B_EMAIL),
      loginUser(ACCOUNTANT_EMAIL)
    ]);
    const [stock, runs, itemsResponse, suppliersResponse, customersResponse] = await Promise.all([
      api('/api/stock/summary', { token }),
      api('/api/production/runs?page=1&limit=1', { token }),
      api('/api/items', { token }),
      api('/api/suppliers', { token }),
      api('/api/customers', { token: admin })
    ]);
    const flour = stock.find(({ code }) => code === 'FLOUR');
    if (flour?.balanceBase !== 100000 || runs.total !== 0) {
      console.error('Database is not fresh. Run: npm run seed:reset');
      process.exitCode = 1;
      return;
    }

    const items = Object.fromEntries(itemsResponse.map((item) => [item.code, item]));
    const supplier = suppliersResponse.find(({ name }) => name === 'Demo Flour Mills');
    const retailerA = customersResponse.find(({ name }) => name === 'Retailer A');
    const distributorB = customersResponse.find(({ name }) => name === 'Distributor B');
    if (!supplier || !items.FLOUR || !items.OIL || !items.SPICE ||
        !items.POUCH200 || !items.CARTON || !items.MURUKKU200 ||
        !retailerA || !distributorB) {
      throw new Error('Benchmark master data is incomplete; run npm run seed:reset');
    }

    let context = {
      token,
      items,
      supplier,
      salesmanA,
      admin,
      salesmanB,
      accountant,
      customers: { retailerA, distributorB }
    };
    for (let index = 0; index < upto; index += 1) {
      const result = await steps[index](context);
      context = { ...context, ...result };
    }
    console.log('Benchmark playback complete.');
    const checkerStage = upto >= 8 ? 'final' : upto >= 5 ? 'after-dispatch' : 'after-run';
    console.log(`Now run: npm run bench:check -- --stage=${checkerStage}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

await main();
