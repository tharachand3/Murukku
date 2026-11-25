const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const PRODUCTION_EMAIL = 'production@demo.com';
const PRODUCTION_PASSWORD = 'Demo@123';

async function api(path, { token, method = 'GET', body } = {}) {
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
  if (!response.ok) {
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
    const token = await login();
    const [stock, runs, itemsResponse, suppliersResponse] = await Promise.all([
      api('/api/stock/summary', { token }),
      api('/api/production/runs?page=1&limit=1', { token }),
      api('/api/items', { token }),
      api('/api/suppliers', { token })
    ]);
    const flour = stock.find(({ code }) => code === 'FLOUR');
    if (flour?.balanceBase !== 100000 || runs.total !== 0) {
      console.error('Database is not fresh. Run: npm run seed:reset');
      process.exitCode = 1;
      return;
    }

    const items = Object.fromEntries(itemsResponse.map((item) => [item.code, item]));
    const supplier = suppliersResponse.find(({ name }) => name === 'Demo Flour Mills');
    if (!supplier || !items.FLOUR || !items.OIL || !items.SPICE ||
        !items.POUCH200 || !items.CARTON || !items.MURUKKU200) {
      throw new Error('Benchmark master data is incomplete; run npm run seed:reset');
    }

    let context = { token, items, supplier };
    for (let index = 0; index < upto; index += 1) {
      const result = await steps[index](context);
      context = { ...context, ...result };
    }
    console.log('Benchmark playback complete.');
    console.log('Now run: npm run bench:check -- --stage=after-run');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

await main();
