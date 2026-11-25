const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const PRODUCTION_EMAIL = 'production@demo.com';
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
    const [token, salesmanA, admin, salesmanB] = await Promise.all([
      login(),
      loginUser(SALESMAN_A_EMAIL),
      loginUser(ADMIN_EMAIL),
      loginUser(SALESMAN_B_EMAIL)
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
