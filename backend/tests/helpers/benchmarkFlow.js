import { apiGet, apiPost, loginAs, BENCH } from './benchmark.js';

function requireStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}`);
  }
}

export async function runBenchmarkPart1(app) {
  const [production, salesmanA, salesmanB, admin, accountant, owner] = await Promise.all([
    loginAs(app, 'production@demo.com'),
    loginAs(app, 'salesman.a@demo.com'),
    loginAs(app, 'salesman.b@demo.com'),
    loginAs(app, 'admin@demo.com'),
    loginAs(app, 'accountant@demo.com'),
    loginAs(app, 'owner@demo.com')
  ]);
  const tokens = { production, salesmanA, salesmanB, admin, accountant, owner };

  const [itemsResponse, suppliersResponse, customersResponse, openingResponse] = await Promise.all([
    apiGet(app, production, '/api/items'),
    apiGet(app, production, '/api/suppliers'),
    apiGet(app, admin, '/api/customers'),
    apiGet(app, production, '/api/stock/summary')
  ]);
  requireStatus(itemsResponse, 200, 'List benchmark items');
  requireStatus(suppliersResponse, 200, 'List benchmark suppliers');
  requireStatus(customersResponse, 200, 'List benchmark customers');
  requireStatus(openingResponse, 200, 'Read opening stock');

  const items = Object.fromEntries(itemsResponse.body.map((item) => [item.code, item]));
  const supplier = suppliersResponse.body.find(({ name }) => name === 'Demo Flour Mills');
  const retailerA = customersResponse.body.find(({ name }) => name === 'Retailer A');
  const distributorB = customersResponse.body.find(({ name }) => name === 'Distributor B');
  if (!supplier || !retailerA || !distributorB ||
      !items.FLOUR || !items.OIL || !items.SPICE ||
      !items.POUCH200 || !items.CARTON || !items.MURUKKU200) {
    throw new Error('Benchmark master data is incomplete');
  }

  const balances = Object.fromEntries(
    openingResponse.body.map(({ code, balanceBase }) => [code, balanceBase])
  );
  for (const [code, expected] of Object.entries(BENCH.opening)) {
    if (balances[code] !== expected) {
      throw new Error(`Opening ${code}: expected ${expected}, received ${balances[code]}`);
    }
  }

  const purchaseResponse = await apiPost(app, production, '/api/purchases', {
    supplierId: supplier.id,
    lines: [{
      itemId: items.FLOUR.id,
      qty: '60',
      unit: 'kg',
      ratePerUnitRupees: '45'
    }]
  });
  requireStatus(purchaseResponse, 201, 'Benchmark purchase');
  const purchase = purchaseResponse.body;

  const runResponse = await apiPost(app, production, '/api/production/runs', {
    finishedItemId: items.MURUKKU200.id,
    batchCount: '1',
    issues: [
      { itemId: items.FLOUR.id, qty: '40', unit: 'kg' },
      { itemId: items.OIL.id, qty: '10.5', unit: 'l' },
      { itemId: items.SPICE.id, qty: '1.2', unit: 'kg' }
    ]
  });
  requireStatus(runResponse, 201, 'Start benchmark production run');
  const run = runResponse.body;

  const completionResponse = await apiPost(
    app,
    production,
    `/api/production/runs/${run.id}/complete`,
    {
      actualGoodQty: 188,
      consumption: [
        { itemId: items.POUCH200.id, qty: '188', unit: 'pcs', scrapQty: '6' },
        { itemId: items.CARTON.id, qty: '9', unit: 'pcs' }
      ]
    }
  );
  requireStatus(completionResponse, 200, 'Complete benchmark production run');
  const completion = completionResponse.body;
  if (purchase.totalPaise !== BENCH.afterPurchase.purchaseAmountPaise ||
      run.status !== 'ISSUED' ||
      completion.status !== 'COMPLETED' ||
      completion.actualGoodQty !== 188 ||
      completion.materialCostPaise !== BENCH.materialCostPaise.total) {
    throw new Error('Benchmark steps 1 to 3 returned unexpected values');
  }

  return {
    tokens,
    ids: {
      items,
      supplier: supplier.id,
      retailerA: retailerA.id,
      distributorB: distributorB.id,
      purchase: purchase.id,
      productionRun: run.id
    }
  };
}
