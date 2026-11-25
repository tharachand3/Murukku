import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import {
  apiGet,
  apiPost,
  BENCH,
  loginAs,
  seedBenchmarkMasters
} from './helpers/benchmark.js';
import { db, resetDb } from './helpers/db.js';

let productionToken;
let salesmanToken;
let adminToken;
let items;
let supplier;
let purchase;
let run;

function sum(rows, select) {
  return rows.reduce((total, row) => total + select(row), 0);
}

function averageRateString(valuePaise, qtyBase) {
  const scaledRate = (
    BigInt(valuePaise) * 10000n + BigInt(qtyBase) / 2n
  ) / BigInt(qtyBase);
  return `${scaledRate / 10000n}.${String(scaledRate % 10000n).padStart(4, '0')}`;
}

function byCode(rows) {
  return Object.fromEntries(rows.map((row) => [row.code, row]));
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  productionToken = await loginAs(app, 'production@demo.com');
  salesmanToken = await loginAs(app, 'salesman.a@demo.com');
  adminToken = await loginAs(app, 'admin@demo.com');

  const [itemsResponse, suppliersResponse] = await Promise.all([
    apiGet(app, productionToken, '/api/items'),
    apiGet(app, productionToken, '/api/suppliers')
  ]);
  expect(itemsResponse.status).toBe(200);
  expect(suppliersResponse.status).toBe(200);
  items = byCode(itemsResponse.body);
  supplier = suppliersResponse.body.find(({ name }) => name === 'Demo Flour Mills');
  expect(Object.keys(items).sort()).toEqual([
    'CARTON',
    'FLOUR',
    'MURUKKU200',
    'OIL',
    'POUCH200',
    'SPICE'
  ]);
  expect(supplier).toBeDefined();
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('benchmark production steps 1 to 3 through the public API', () => {
  it('step 1: purchases flour and verifies the purchase ledger and average rate', async () => {
    const openingResponse = await apiGet(app, productionToken, '/api/stock/summary');
    expect(openingResponse.status).toBe(200);
    const openingBalances = byCode(openingResponse.body);
    for (const [code, expected] of Object.entries(BENCH.opening)) {
      expect(openingBalances[code].balanceBase, code).toBe(expected);
    }

    const response = await apiPost(app, productionToken, '/api/purchases', {
      supplierId: supplier.id,
      lines: [{
        itemId: items.FLOUR.id,
        qty: '60',
        unit: 'kg',
        ratePerUnitRupees: '45'
      }]
    });

    expect(response.status).toBe(201);
    purchase = response.body;
    expect(purchase.number).toMatch(/^PUR\/\d{4}-\d{2}\/0001$/);
    expect(purchase.totalPaise).toBe(BENCH.afterPurchase.purchaseAmountPaise);
    expect(purchase.lines[0]).toMatchObject({
      qtyBase: BENCH.afterPurchase.purchaseQty,
      ratePaisePerBase: BENCH.afterPurchase.purchaseRatePaisePerBase,
      amountPaise: BENCH.afterPurchase.purchaseAmountPaise
    });

    const [summary, ledger] = await Promise.all([
      apiGet(app, productionToken, '/api/stock/summary'),
      apiGet(app, productionToken, `/api/stock/ledger?itemId=${items.FLOUR.id}`)
    ]);
    expect(summary.status).toBe(200);
    expect(ledger.status).toBe(200);
    expect(summary.body.find(({ code }) => code === 'FLOUR').balanceBase)
      .toBe(BENCH.afterPurchase.FLOUR);
    const purchaseMovement = ledger.body.rows.find(({ sourceRef }) =>
      sourceRef === purchase.number
    );
    expect(purchaseMovement).toMatchObject({
      movementType: 'PURCHASE',
      sourceType: 'PURCHASE',
      qtyIn: BENCH.afterPurchase.purchaseQty,
      valuePaise: BENCH.afterPurchase.purchaseAmountPaise
    });

    const pricedReceipts = ledger.body.rows.filter(({ movementType }) =>
      ['OPENING', 'PURCHASE'].includes(movementType)
    );
    const receiptQty = sum(pricedReceipts, ({ qtyIn }) => qtyIn);
    const receiptValue = sum(pricedReceipts, ({ valuePaise }) => valuePaise);
    expect(averageRateString(receiptValue, receiptQty))
      .toBe(BENCH.afterPurchase.flourAverageRatePaisePerBase);
  });

  it('step 2: starts a run and checks issued stock and the saved average rate', async () => {
    const response = await apiPost(app, productionToken, '/api/production/runs', {
      finishedItemId: items.MURUKKU200.id,
      batchCount: '1',
      issues: [
        { itemId: items.FLOUR.id, qty: '40', unit: 'kg' },
        { itemId: items.OIL.id, qty: '10.5', unit: 'l' },
        { itemId: items.SPICE.id, qty: '1.2', unit: 'kg' }
      ]
    });

    expect(response.status).toBe(201);
    run = response.body;
    expect(run.runNo).toMatch(/^RUN\/\d{4}-\d{2}\/0001$/);
    expect(run.status).toBe('ISSUED');
    expect(run.lines.find(({ itemId }) => itemId === items.FLOUR.id)).toMatchObject({
      issuedQtyBase: 40000,
      ratePaisePerBase: BENCH.afterPurchase.flourAverageRatePaisePerBase,
      costPaise: BENCH.materialCostPaise.FLOUR
    });

    const responseSummary = await apiGet(app, productionToken, '/api/stock/summary');
    expect(responseSummary.status).toBe(200);
    const balances = byCode(responseSummary.body);
    for (const [code, expected] of Object.entries(BENCH.afterIssue)) {
      expect(balances[code].balanceBase, code).toBe(expected);
    }
  });

  it('step 3: completes the run and verifies variance, audit, traceability and reconciliation', async () => {
    const response = await apiPost(
      app,
      productionToken,
      `/api/production/runs/${run.id}/complete`,
      {
        actualGoodQty: 188,
        consumption: [
          { itemId: items.POUCH200.id, qty: '188', unit: 'pcs', scrapQty: '6' },
          { itemId: items.CARTON.id, qty: '9', unit: 'pcs' }
        ]
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'COMPLETED',
      actualGoodQty: 188,
      materialCostPaise: BENCH.materialCostPaise.total
    });
    const costsByItemId = Object.fromEntries(
      response.body.lines.map((line) => [line.itemId, line.costPaise])
    );
    for (const [code, expected] of Object.entries(BENCH.materialCostPaise)) {
      if (code !== 'total') {
        expect(costsByItemId[items[code].id], code).toBe(expected);
      }
    }

    const [variance, detail, summary] = await Promise.all([
      apiGet(app, productionToken, `/api/production/runs/${run.id}/variance`),
      apiGet(app, productionToken, `/api/production/runs/${run.id}`),
      apiGet(app, productionToken, '/api/stock/summary')
    ]);
    expect(variance.status).toBe(200);
    expect(variance.body.yield).toMatchObject(BENCH.variance.yield);
    const varianceByItemId = Object.fromEntries(
      variance.body.lines.map((line) => [line.itemId, line])
    );
    for (const code of ['FLOUR', 'OIL', 'SPICE', 'POUCH200', 'CARTON']) {
      expect(varianceByItemId[items[code].id], code).toMatchObject(BENCH.variance[code]);
    }
    expect(variance.body.alerts.join('\n')).toContain('Yield 188 vs 200');
    expect(variance.body.alerts.join('\n')).toContain('Oil used 10.5 l vs 10 l');

    expect(detail.status).toBe(200);
    expect(detail.body.ledgerRows).toHaveLength(7);
    expect(detail.body.ledgerRows.every((row) =>
      row.sourceType === 'PRODUCTION_RUN' &&
      row.sourceId === run.id &&
      row.sourceRef === run.runNo
    )).toBe(true);
    expect(detail.body.ledgerRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: items.FLOUR.id,
        movementType: 'PRODUCTION_ISSUE',
        qtyChange: -40000
      }),
      expect.objectContaining({
        itemId: items.OIL.id,
        movementType: 'PRODUCTION_ISSUE',
        qtyChange: -10500
      }),
      expect.objectContaining({
        itemId: items.SPICE.id,
        movementType: 'PRODUCTION_ISSUE',
        qtyChange: -1200
      }),
      expect.objectContaining({
        itemId: items.POUCH200.id,
        movementType: 'PRODUCTION_ISSUE',
        qtyChange: -188
      }),
      expect.objectContaining({
        itemId: items.POUCH200.id,
        movementType: 'PRODUCTION_SCRAP',
        qtyChange: -6
      }),
      expect.objectContaining({
        itemId: items.CARTON.id,
        movementType: 'PRODUCTION_ISSUE',
        qtyChange: -9
      }),
      expect.objectContaining({
        itemId: items.MURUKKU200.id,
        movementType: 'PRODUCTION_OUTPUT',
        qtyChange: 188
      })
    ]));

    expect(summary.status).toBe(200);
    const balances = byCode(summary.body);
    for (const [code, expected] of Object.entries(BENCH.afterRun)) {
      expect(balances[code].balanceBase, code).toBe(expected);
    }

    const allLedgers = await Promise.all(summary.body.map(({ itemId }) =>
      apiGet(app, productionToken, `/api/stock/ledger?itemId=${itemId}`)
    ));
    expect(allLedgers.every(({ status }) => status === 200)).toBe(true);
    const allRows = allLedgers.flatMap(({ body }) => body.rows);
    expect(allRows.every((row) => row.sourceType !== null && row.sourceType !== undefined))
      .toBe(true);
    for (const [index, balance] of summary.body.entries()) {
      const rows = allLedgers[index].body.rows;
      const openingQty = sum(
        rows.filter(({ movementType }) => movementType === 'OPENING'),
        ({ qtyIn }) => qtyIn
      );
      const receiptQty = sum(
        rows.filter(({ movementType }) => movementType !== 'OPENING'),
        ({ qtyIn }) => qtyIn
      );
      const issueQty = sum(rows, ({ qtyOut }) => qtyOut);
      expect(openingQty + receiptQty - issueQty, balance.code).toBe(balance.balanceBase);
      expect(sum(rows, ({ qtyIn, qtyOut }) => qtyIn - qtyOut), balance.code)
        .toBe(balance.balanceBase);
    }

    const [purchaseAudit, runAudit] = await Promise.all([
      apiGet(app, adminToken, `/api/audit?entity=Purchase&entityId=${purchase.id}`),
      apiGet(app, adminToken, `/api/audit?entity=ProductionRun&entityId=${run.id}`)
    ]);
    expect(purchaseAudit.status).toBe(200);
    expect(purchaseAudit.body.items.some(({ action }) => action === 'CREATE')).toBe(true);
    expect(runAudit.status).toBe(200);
    expect(runAudit.body.items.map(({ action }) => action).sort())
      .toEqual(['CREATE', 'UPDATE']);

    const [salesmanPurchase, salesmanSummary, availability] = await Promise.all([
      apiPost(app, salesmanToken, '/api/purchases', {
        supplierId: supplier.id,
        lines: [{
          itemId: items.FLOUR.id,
          qty: '1',
          unit: 'kg',
          ratePerUnitRupees: '45'
        }]
      }),
      apiGet(app, salesmanToken, '/api/stock/summary'),
      apiGet(app, salesmanToken, '/api/stock/finished-availability')
    ]);
    expect(salesmanPurchase.status).toBe(403);
    expect(salesmanSummary.status).toBe(403);
    expect(availability.status).toBe(200);
    expect(availability.body).toHaveLength(1);
    expect(availability.body[0]).toMatchObject({
      itemId: items.MURUKKU200.id,
      availablePackets: BENCH.afterRun.MURUKKU200
    });

    const repeatedCompletion = await apiPost(
      app,
      productionToken,
      `/api/production/runs/${run.id}/complete`,
      { actualGoodQty: 188 }
    );
    expect(repeatedCompletion.status).toBe(409);
    expect(repeatedCompletion.body.error.code).toBe('RUN_NOT_OPEN');
  });
});
