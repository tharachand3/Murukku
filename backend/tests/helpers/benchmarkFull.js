import { currentFinancialYear } from '../../src/lib/fy.js';
import { apiPost } from './benchmark.js';
import { runBenchmarkPart1 } from './benchmarkFlow.js';

function requireStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}`);
  }
}

export async function runBenchmarkFull(app) {
  const first = await runBenchmarkPart1(app);
  const { tokens } = first;
  const { items } = first.ids;

  const orderResponse = await apiPost(app, tokens.salesmanA, '/api/orders', {
    clientRef: 'benchmark-retailer-a-0001',
    customerId: first.ids.retailerA,
    lines: [{ itemId: items.MURUKKU200.id, qty: 150 }]
  });
  requireStatus(orderResponse, 201, 'Create benchmark Retailer A order');
  const orderA = orderResponse.body.order;

  const approval = await apiPost(
    app,
    tokens.admin,
    `/api/orders/${orderA.id}/approve`,
    {}
  );
  requireStatus(approval, 200, 'Approve benchmark Retailer A order');

  const invoiceResponse = await apiPost(app, tokens.admin, '/api/invoices', {
    orderId: orderA.id
  });
  requireStatus(invoiceResponse, 201, 'Create benchmark Retailer A invoice');
  const invoiceA = invoiceResponse.body;

  const dispatchResponse = await apiPost(app, tokens.admin, '/api/dispatches', {
    invoiceId: invoiceA.id
  });
  requireStatus(dispatchResponse, 201, 'Dispatch benchmark Retailer A invoice');
  const dispatchA = dispatchResponse.body.dispatch;

  const orderBResponse = await apiPost(app, tokens.salesmanB, '/api/orders', {
    clientRef: 'benchmark-distributor-b-0001',
    customerId: first.ids.distributorB,
    lines: [{ itemId: items.MURUKKU200.id, qty: 120 }]
  });
  requireStatus(orderBResponse, 201, 'Create benchmark Distributor B order');
  const orderB = orderBResponse.body.order;

  const paymentResponse = await apiPost(app, tokens.admin, '/api/payments', {
    customerId: first.ids.retailerA,
    invoiceId: invoiceA.id,
    amountPaise: 400000,
    mode: 'UPI',
    reference: 'UPI123456'
  });
  requireStatus(paymentResponse, 201, 'Record benchmark Retailer A payment');
  const paymentA = paymentResponse.body.payment;

  const labour = await apiPost(
    app,
    tokens.production,
    `/api/production/runs/${first.ids.productionRun}/overheads`,
    { kind: 'LABOUR', amountPaise: 120000, note: 'Benchmark labour' }
  );
  requireStatus(labour, 201, 'Record benchmark labour overhead');
  const powerGas = await apiPost(
    app,
    tokens.production,
    `/api/production/runs/${first.ids.productionRun}/overheads`,
    { kind: 'POWER_GAS', amountPaise: 60000, note: 'Benchmark power and gas' }
  );
  requireStatus(powerGas, 201, 'Record benchmark power/gas overhead');

  return {
    app,
    FY: currentFinancialYear(),
    tokens,
    ids: {
      retailerA: first.ids.retailerA,
      distributorB: first.ids.distributorB,
      murukku: items.MURUKKU200.id,
      flour: items.FLOUR.id,
      oil: items.OIL.id,
      spice: items.SPICE.id,
      pouch: items.POUCH200.id,
      carton: items.CARTON.id,
      supplier: first.ids.supplier,
      runId: first.ids.productionRun,
      orderA: orderA.id,
      invoiceA: invoiceA.id,
      dispatchA: dispatchA.id,
      paymentA: paymentA.id,
      orderB: orderB.id
    }
  };
}
