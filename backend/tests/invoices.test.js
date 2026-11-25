import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { getBalance } from '../src/services/ledgerService.js';
import { apiGet, apiPost, BENCH, loginAs, seedBenchmarkMasters } from './helpers/benchmark.js';
import { db, resetDb } from './helpers/db.js';

let users;
let items;
let customers;
let tokens;
let retailerOrder;
let distributorOrder;
let baselineMovementCount;
let baselineFinishedBalance;
let clientRef = 1;

async function createOrder(token, customerId, qty) {
  const response = await apiPost(app, token, '/api/orders', {
    clientRef: `step28-ref-${String(clientRef++).padStart(6, '0')}`,
    customerId,
    lines: [{ itemId: items.finished.id, qty }]
  });
  expect(response.status).toBe(201);
  return response.body.order;
}

async function approveOrder(order, token, approvedQty, approvedPricePaise) {
  const response = await apiPost(app, token, `/api/orders/${order.id}/approve`, {
    ...(approvedQty === undefined
      ? {}
      : {
          lines: [{
            lineId: order.lines[0].lineId,
            approvedQty,
            ...(approvedPricePaise === undefined ? {} : { approvedPricePaise })
          }]
        })
  });
  return response;
}

async function getInvoiceCounter() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric'
  }).formatToParts(new Date());
  const localMonth = Number(parts.find(({ type }) => type === 'month').value);
  const localYear = Number(parts.find(({ type }) => type === 'year').value);
  const startYear = localMonth >= 4 ? localYear : localYear - 1;
  const financialYear = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  return db.documentCounter.findUnique({ where: { key: `INV:${financialYear}` } });
}

function istDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const part = (type) => parts.find((entry) => entry.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
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
  baselineMovementCount = await db.stockMovement.count();
  baselineFinishedBalance = await getBalance(db, items.finished.id);

  retailerOrder = await createOrder(tokens.salesmanA, customers.retailerA.id, 150);
  distributorOrder = await createOrder(tokens.salesmanB, customers.distributorB.id, 120);
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('posted invoices', () => {
  it('creates an immutable-value GST invoice atomically and blocks duplicates', async () => {
    expect((await approveOrder(retailerOrder, tokens.admin)).status).toBe(200);
    const beforeCounter = await getInvoiceCounter();
    const response = await apiPost(app, tokens.admin, '/api/invoices', {
      orderId: retailerOrder.id
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      invoiceNo: expect.stringMatching(/^INV\/\d{4}-\d{2}\/0002$/),
      invoiceNo: expect.stringMatching(/^INV\/\d{4}-\d{2}\/0001$/),
      orderId: retailerOrder.id,
      customer: {
        id: customers.retailerA.id,
        name: 'Retailer A',
        gstin: customers.retailerA.gstin,
        stateCode: '33'
      },
      snapshot: {
        seller: {
          name: 'Sri Murugan Snacks (Demo)',
          gstin: '33ABCDE1234F1Z5',
          stateCode: '33'
        },
        buyer: { id: customers.retailerA.id, name: 'Retailer A' },
        orderNo: retailerOrder.orderNo
      },
      status: 'POSTED',
      isInterState: false,
      taxableValuePaise: 750000,
      cgstPaise: 18750,
      sgstPaise: 18750,
      igstPaise: 0,
      totalPaise: 787500,
      totalDisplay: 'Rs 7,875.00',
      lines: [{
        itemId: items.finished.id,
        description: 'Murukku 200 g',
        hsnCode: items.finished.hsnCode,
        qty: 150,
        ratePaise: 5000,
        taxableValuePaise: 750000,
        gstRateBp: items.finished.gstRateBp,
        cgstPaise: 18750,
        sgstPaise: 18750,
        igstPaise: 0,
        totalPaise: 787500,
        dispatchedQty: 0
      }]
    });
    expect(await db.order.findUnique({
      where: { id: retailerOrder.id },
      select: { status: true }
    })).toEqual({ status: 'INVOICED' });
    expect(await db.auditLog.count({
      where: { entity: 'Invoice', entityId: response.body.id, action: 'CREATE' }
    })).toBe(1);
    const orderDetail = await apiGet(app, tokens.admin, `/api/orders/${retailerOrder.id}`);
    expect(orderDetail.body.timeline).toContainEqual(
      expect.objectContaining({ action: 'INVOICE', note: response.body.invoiceNo })
    );

    const duplicate = await apiPost(app, tokens.admin, '/api/invoices', {
      orderId: retailerOrder.id
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ALREADY_INVOICED');
    expect((await getInvoiceCounter()).lastNumber).toBe(beforeCounter?.lastNumber ?? 1);
    expect(await db.stockMovement.count()).toBe(baselineMovementCount);
    expect(await getBalance(db, items.finished.id)).toBe(baselineFinishedBalance);
  });

  it('invoices interstate orders with partial approved quantities and GST snapshots', async () => {
    expect((await approveOrder(distributorOrder, tokens.admin, 88, 4500)).status).toBe(200);
    const response = await apiPost(app, tokens.admin, '/api/invoices', {
      orderId: distributorOrder.id
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      isInterState: true,
      placeOfSupplyStateCode: '29',
      taxableValuePaise: 396000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 19800,
      totalPaise: 415800,
      lines: [{
        qty: 88,
        ratePaise: 4500,
        taxableValuePaise: 396000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 19800
      }]
    });
    expect(await db.order.findUnique({
      where: { id: distributorOrder.id },
      select: { status: true }
    })).toEqual({ status: 'INVOICED' });
    expect(await db.stockMovement.count()).toBe(baselineMovementCount);
  });

  it('rejects submitted or rejected orders and handles unknown orders', async () => {
    const submitted = await createOrder(tokens.salesmanA, customers.retailerA.id, 1);
    const submittedResponse = await apiPost(app, tokens.admin, '/api/invoices', {
      orderId: submitted.id
    });
    expect(submittedResponse.status).toBe(409);
    expect(submittedResponse.body.error).toMatchObject({
      code: 'INVALID_STATUS',
      details: { from: 'SUBMITTED', to: 'INVOICED' }
    });

    const rejected = await createOrder(tokens.salesmanA, customers.retailerA.id, 1);
    await db.order.update({ where: { id: rejected.id }, data: { status: 'REJECTED' } });
    const rejectedResponse = await apiPost(app, tokens.admin, '/api/invoices', {
      orderId: rejected.id
    });
    expect(rejectedResponse.status).toBe(409);
    expect(rejectedResponse.body.error.code).toBe('INVALID_STATUS');

    const missing = await apiPost(app, tokens.admin, '/api/invoices', { orderId: 2147483647 });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect(await db.stockMovement.count()).toBe(baselineMovementCount);
  });

  it('serializes five concurrent creates for an approved order and consumes one number', async () => {
    const order = await createOrder(tokens.salesmanA, customers.retailerA.id, 1);
    await db.order.update({
      where: { id: order.id },
      data: {
        status: 'APPROVED',
        approvedById: users.admin.id,
        approvedAt: new Date()
      }
    });
    await db.orderLine.update({
      where: { id: order.lines[0].lineId },
      data: { approvedQty: 1, approvedPricePaise: 5000 }
    });
    const counterBefore = (await getInvoiceCounter()).lastNumber;

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        apiPost(app, tokens.admin, '/api/invoices', { orderId: order.id })
      )
    );
    expect(responses.filter(({ status }) => status === 201)).toHaveLength(1);
    expect(responses.filter(({ status }) => status === 409)).toHaveLength(4);
    expect(responses.filter(({ body }) =>
      body.error?.code === 'ALREADY_INVOICED'
    )).toHaveLength(4);
    expect(await db.invoice.count({ where: { orderId: order.id } })).toBe(1);
    expect((await getInvoiceCounter()).lastNumber).toBe(counterBefore + 1);
    expect(await db.stockMovement.count()).toBe(baselineMovementCount);
  });

  it('lists invoices with filters and pagination and enforces invoice roles', async () => {
    const invoice = await db.invoice.findUnique({
      where: { orderId: retailerOrder.id }
    });
    const invoiceDate = istDate(invoice.issueDate);
    const path = `/api/invoices?status=POSTED&customerId=${customers.retailerA.id}` +
      `&from=${invoiceDate}&to=${invoiceDate}&q=${invoice.invoiceNo}&page=1&limit=1`;
    const listed = await apiGet(app, tokens.admin, path);
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      page: 1,
      limit: 1,
      total: 1,
      items: [{
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        totalDisplay: 'Rs 7,875.00'
      }]
    });

    for (const role of ['salesmanA', 'production']) {
      expect((await apiGet(app, tokens[role], '/api/invoices')).status).toBe(403);
    }
    expect((await apiGet(app, tokens.accountant, '/api/invoices')).status).toBe(200);
    expect((await apiGet(app, tokens.owner, `/api/invoices/${invoice.id}`)).status).toBe(200);
    expect((await request(app).get('/api/invoices')).status).toBe(401);
    expect((await apiPost(app, tokens.accountant, '/api/invoices', {
      orderId: retailerOrder.id
    })).status).toBe(403);
    expect((await apiPost(app, undefined, '/api/invoices', {
      orderId: retailerOrder.id
    })).status).toBe(401);
  });

  it('keeps invoice descriptions, tax, and buyer identity after master data changes', async () => {
    const invoice = await db.invoice.findUnique({
      where: { orderId: retailerOrder.id },
      include: { lines: true }
    });
    await db.item.update({
      where: { id: items.finished.id },
      data: { name: 'Renamed item', hsnCode: '99999999', gstRateBp: 1200, sellingPricePaise: 9900 }
    });
    await db.customer.update({
      where: { id: customers.retailerA.id },
      data: { name: 'Renamed retailer' }
    });

    const response = await apiGet(app, tokens.admin, `/api/invoices/${invoice.id}`);
    expect(response.status).toBe(200);
    expect(response.body.customer.name).toBe('Retailer A');
    expect(response.body.snapshot.buyer.name).toBe('Retailer A');
    expect(response.body.lines[0]).toMatchObject({
      description: 'Murukku 200 g',
      hsnCode: items.finished.hsnCode,
      gstRateBp: items.finished.gstRateBp,
      ratePaise: 5000,
      taxableValuePaise: 750000,
      dispatchedQty: 0
    });
    expect(response.body.totalPaise).toBe(787500);
  });

  it('does not expose invoice update or delete routes and validates strict input', async () => {
    const invoice = await db.invoice.findUnique({
      where: { orderId: retailerOrder.id }
    });
    const path = `/api/invoices/${invoice.id}`;
    expect((await apiPost(app, tokens.admin, '/api/invoices', {
      orderId: retailerOrder.id,
      status: 'CANCELLED'
    })).status).toBe(400);
    expect((await request(app).patch(path).set('Authorization', `Bearer ${tokens.admin}`).send({})).status)
      .toBe(404);
    expect((await request(app).put(path).set('Authorization', `Bearer ${tokens.admin}`).send({})).status)
      .toBe(404);
    expect((await request(app).delete(path).set('Authorization', `Bearer ${tokens.admin}`)).status)
      .toBe(404);
  });
});
