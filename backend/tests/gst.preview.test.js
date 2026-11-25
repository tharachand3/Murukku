import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { getBalance } from '../src/services/ledgerService.js';
import { buildOrderInvoiceDraft } from '../src/services/gstService.js';
import { apiGet, apiPost, BENCH, loginAs, seedBenchmarkMasters } from './helpers/benchmark.js';
import { db, resetDb } from './helpers/db.js';

let users;
let items;
let customers;
let tokens;
let orders;

async function getDocumentCounters() {
  return db.documentCounter.findMany({ orderBy: { key: 'asc' } });
}

async function createOrder({ token, customerId, clientRef, lines }) {
  const response = await apiPost(app, token, '/api/orders', {
    clientRef,
    customerId,
    lines
  });
  expect(response.status).toBe(201);
  return response.body.order;
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  const [
    admin,
    owner,
    production,
    salesmanA,
    salesmanB,
    accountant,
    finished,
    pouch,
    carton,
    retailerA,
    distributorB
  ] = await Promise.all([
    db.user.findUnique({ where: { email: 'admin@demo.com' } }),
    db.user.findUnique({ where: { email: 'owner@demo.com' } }),
    db.user.findUnique({ where: { email: 'production@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.a@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.b@demo.com' } }),
    db.user.findUnique({ where: { email: 'accountant@demo.com' } }),
    db.item.findUnique({ where: { code: 'MURUKKU200' } }),
    db.item.findUnique({ where: { code: 'POUCH200' } }),
    db.item.findUnique({ where: { code: 'CARTON' } }),
    db.customer.findFirst({ where: { name: 'Retailer A' } }),
    db.customer.findFirst({ where: { name: 'Distributor B' } })
  ]);
  users = { admin, owner, production, salesmanA, salesmanB, accountant };
  items = { finished, pouch, carton };
  customers = { retailerA, distributorB };

  const [adminToken, ownerToken, productionToken, salesmanAToken, salesmanBToken, accountantToken] =
    await Promise.all([
      loginAs(app, admin.email),
      loginAs(app, owner.email),
      loginAs(app, production.email),
      loginAs(app, salesmanA.email),
      loginAs(app, salesmanB.email),
      loginAs(app, accountant.email)
    ]);
  tokens = {
    admin: adminToken,
    owner: ownerToken,
    production: productionToken,
    salesmanA: salesmanAToken,
    salesmanB: salesmanBToken,
    accountant: accountantToken
  };

  const started = await apiPost(app, tokens.production, '/api/production/runs', {
    finishedItemId: items.finished.id,
    batchCount: '1'
  });
  expect(started.status).toBe(201);
  const completed = await apiPost(
    app,
    tokens.production,
    `/api/production/runs/${started.body.id}/complete`,
    {
      actualGoodQty: 188,
      consumption: [
        { itemId: items.pouch.id, qty: '188', unit: 'pcs', scrapQty: '6' },
        { itemId: items.carton.id, qty: '9', unit: 'pcs' }
      ]
    }
  );
  expect(completed.status).toBe(200);
  expect(await getBalance(db, items.finished.id)).toBe(BENCH.afterRun.MURUKKU200);

  const retailerOrder = await createOrder({
    token: tokens.salesmanA,
    customerId: customers.retailerA.id,
    clientRef: 'gst-preview-retailer-001',
    lines: [{ itemId: items.finished.id, qty: 150 }]
  });
  const distributorOrder = await createOrder({
    token: tokens.salesmanB,
    customerId: customers.distributorB.id,
    clientRef: 'gst-preview-distributor-01',
    lines: [{ itemId: items.finished.id, qty: 120 }]
  });
  orders = { retailer: retailerOrder, distributor: distributorOrder };
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('order invoice preview', () => {
  it('previews the benchmark intra-state totals without writing invoices or counters', async () => {
    const invoicesBefore = await db.invoice.count();
    const countersBefore = await getDocumentCounters();
    const response = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${orders.retailer.id}/invoice-preview`
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      orderId: orders.retailer.id,
      orderNo: orders.retailer.orderNo,
      customer: {
        id: customers.retailerA.id,
        name: 'Retailer A',
        stateCode: '33'
      },
      seller: {
        name: 'Sri Murugan Snacks (Demo)',
        gstin: '33ABCDE1234F1Z5',
        stateCode: '33'
      },
      placeOfSupplyStateCode: '33',
      isInterState: false,
      lines: [{
        itemId: items.finished.id,
        description: 'Murukku 200 g',
        qty: 150,
        ratePaise: 5000,
        taxableValuePaise: 750000,
        cgstPaise: 18750,
        sgstPaise: 18750,
        igstPaise: 0,
        totalPaise: 787500,
        rateDisplay: 'Rs 50.00',
        taxableValueDisplay: 'Rs 7,500.00',
        totalDisplay: 'Rs 7,875.00'
      }],
      totals: {
        taxableValuePaise: 750000,
        cgstPaise: 18750,
        sgstPaise: 18750,
        igstPaise: 0,
        totalPaise: 787500,
        totalDisplay: 'Rs 7,875.00'
      }
    });
    expect(await db.invoice.count()).toBe(invoicesBefore);
    expect(await getDocumentCounters()).toEqual(countersBefore);
  });

  it('previews the distributor order with IGST only', async () => {
    const response = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${orders.distributor.id}/invoice-preview`
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      isInterState: true,
      placeOfSupplyStateCode: '29',
      totals: {
        taxableValuePaise: 600000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 30000,
        totalPaise: 630000
      }
    });
  });

  it('supports quantity overrides for internal draft previews', async () => {
    const draft = await buildOrderInvoiceDraft(prisma, orders.retailer.id, {
      qtyOverrides: new Map([[items.finished.id, 30]])
    });
    expect(draft.lines[0]).toMatchObject({
      qty: 30,
      taxableValuePaise: 150000,
      cgstPaise: 3750,
      sgstPaise: 3750,
      totalPaise: 157500
    });
  });

  it('uses edited effective prices and skips zero-quantity lines', async () => {
    const editedLineId = orders.retailer.lines[0].lineId;
    const edit = await request(app)
      .patch(`/api/orders/${orders.retailer.id}/lines`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        lines: [{ lineId: editedLineId, approvedPricePaise: 4800 }]
      });
    expect(edit.status).toBe(200);
      const approved = await apiPost(
        app,
        tokens.admin,
        `/api/orders/${orders.retailer.id}/approve`,
        {}
      );
      expect(approved.status).toBe(200);

    const alternateItem = await db.item.create({
      data: {
        code: 'GST-ALT-FINISHED',
        name: 'GST alternate snack',
        type: 'FINISHED',
        baseUnitId: items.finished.baseUnitId,
        displayUnitId: items.finished.displayUnitId,
        hsnCode: '21069099',
        gstRateBp: 1200,
        sellingPricePaise: 5000
      }
    });
    const multiLineOrder = await createOrder({
      token: tokens.salesmanA,
      customerId: customers.retailerA.id,
      clientRef: 'gst-preview-multiline-01',
      lines: [
        { itemId: items.finished.id, qty: 10 },
        { itemId: alternateItem.id, qty: 10 }
      ]
    });
    const alternateLine = await db.orderLine.findFirst({
      where: { orderId: multiLineOrder.id, itemId: alternateItem.id }
    });
    await db.orderLine.update({
      where: { id: alternateLine.id },
      data: { approvedQty: 0, approvedPricePaise: 5000 }
    });

    const editedPreview = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${orders.retailer.id}/invoice-preview`
    );
    expect(editedPreview.body.lines[0]).toMatchObject({
      qty: 150,
      ratePaise: 4800,
      taxableValuePaise: 720000,
      cgstPaise: 18000,
      sgstPaise: 18000,
      totalPaise: 756000
    });

    const skippedPreview = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${multiLineOrder.id}/invoice-preview`
    );
    expect(skippedPreview.status).toBe(200);
    expect(skippedPreview.body.lines).toHaveLength(1);
    expect(skippedPreview.body.lines[0].itemId).toBe(items.finished.id);
  });

  it('rejects non-previewable and unknown orders', async () => {
    const rejectedOrder = await createOrder({
      token: tokens.salesmanA,
      customerId: customers.retailerA.id,
      clientRef: 'gst-preview-rejected-01',
      lines: [{ itemId: items.finished.id, qty: 1 }]
    });
    await db.order.update({
      where: { id: rejectedOrder.id },
      data: { status: 'REJECTED' }
    });
    const rejected = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${rejectedOrder.id}/invoice-preview`
    );
    expect(rejected.status).toBe(409);
    expect(rejected.body.error).toMatchObject({
      code: 'INVALID_STATUS',
      details: { from: 'REJECTED', to: 'INVOICED' }
    });

    const missing = await apiGet(app, tokens.admin, '/api/orders/2147483647/invoice-preview');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('requires the seller state setting and enforces invoice-read access', async () => {
    const stateSetting = await db.setting.findUnique({
      where: { key: 'COMPANY_STATE_CODE' }
    });
    await db.setting.delete({ where: { key: 'COMPANY_STATE_CODE' } });
    let missingSetting;
    try {
      missingSetting = await apiGet(
        app,
        tokens.admin,
        `/api/orders/${orders.retailer.id}/invoice-preview`
      );
    } finally {
      await db.setting.create({
        data: { key: stateSetting.key, value: stateSetting.value }
      });
    }
    expect(missingSetting.status).toBe(422);
    expect(missingSetting.body.error).toMatchObject({
      code: 'SETTING_MISSING',
      details: { key: 'COMPANY_STATE_CODE' }
    });

    expect((await apiGet(
      app,
      tokens.salesmanA,
      `/api/orders/${orders.retailer.id}/invoice-preview`
    )).status).toBe(403);
    expect((await apiGet(
      app,
      tokens.accountant,
      `/api/orders/${orders.retailer.id}/invoice-preview`
    )).status).toBe(200);
    expect((await apiGet(
      app,
      tokens.owner,
      `/api/orders/${orders.retailer.id}/invoice-preview`
    )).status).toBe(200);
    expect((await request(app)
      .get(`/api/orders/${orders.retailer.id}/invoice-preview`)).status).toBe(401);
  });
});
