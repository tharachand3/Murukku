import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { getBalance } from '../src/services/ledgerService.js';
import {
  apiGet,
  apiPost,
  loginAs,
  seedBenchmarkMasters,
  BENCH
} from './helpers/benchmark.js';
import { db, resetDb } from './helpers/db.js';

let users;
let items;
let customers;
let tokens;
let invoice;

async function setupBenchmarkInvoice() {
  await resetDb();
  await seedBenchmarkMasters();
  const [
    admin,
    owner,
    accountant,
    salesman,
    salesmanB,
    production,
    finished,
    pouch,
    carton,
    retailerA,
    distributorB
  ] = await Promise.all([
    db.user.findUnique({ where: { email: 'admin@demo.com' } }),
    db.user.findUnique({ where: { email: 'owner@demo.com' } }),
    db.user.findUnique({ where: { email: 'accountant@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.a@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.b@demo.com' } }),
    db.user.findUnique({ where: { email: 'production@demo.com' } }),
    db.item.findUnique({ where: { code: 'MURUKKU200' } }),
    db.item.findUnique({ where: { code: 'POUCH200' } }),
    db.item.findUnique({ where: { code: 'CARTON' } }),
    db.customer.findFirst({ where: { name: 'Retailer A' } }),
    db.customer.findFirst({ where: { name: 'Distributor B' } })
  ]);
  users = { admin, owner, accountant, salesman, salesmanB, production };
  items = { finished, pouch, carton };
  customers = { retailerA, distributorB };
  const [adminToken, ownerToken, accountantToken, salesmanToken, salesmanBToken, productionToken] =
    await Promise.all([
      loginAs(app, admin.email),
      loginAs(app, owner.email),
      loginAs(app, accountant.email),
      loginAs(app, salesman.email),
      loginAs(app, salesmanB.email),
      loginAs(app, production.email)
    ]);
  tokens = {
    admin: adminToken,
    owner: ownerToken,
    accountant: accountantToken,
    salesman: salesmanToken,
    salesmanB: salesmanBToken,
    production: productionToken
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

  const orderResponse = await apiPost(app, tokens.salesman, '/api/orders', {
    clientRef: 'step30-retailer-0001',
    customerId: customers.retailerA.id,
    lines: [{ itemId: items.finished.id, qty: 150 }]
  });
  expect(orderResponse.status).toBe(201);
  const order = orderResponse.body.order;
  expect((await apiPost(app, tokens.admin, `/api/orders/${order.id}/approve`, {})).status)
    .toBe(200);
  const invoiceResponse = await apiPost(app, tokens.admin, '/api/invoices', {
    orderId: order.id
  });
  expect(invoiceResponse.status).toBe(201);
  invoice = invoiceResponse.body;
  expect(invoice.totalPaise).toBe(787500);
  const dispatchResponse = await apiPost(app, tokens.admin, '/api/dispatches', {
    invoiceId: invoice.id
  });
  expect(dispatchResponse.status).toBe(201);
}

beforeEach(async () => {
  await setupBenchmarkInvoice();
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('payments and customer outstanding', () => {
  it('records a linked payment and reports benchmark outstanding by customer', async () => {
    const response = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: invoice.id,
      amountPaise: 400000,
      mode: 'UPI',
      reference: 'UPI123456'
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      payment: {
        receiptNo: expect.stringMatching(/^RCT\/\d{4}-\d{2}\/0001$/),
        customer: { id: customers.retailerA.id, name: 'Retailer A' },
        invoice: { id: invoice.id, invoiceNo: invoice.invoiceNo },
        amountPaise: 400000,
        amountDisplay: 'Rs 4,000.00',
        mode: 'UPI',
        reference: 'UPI123456'
      },
      customerBalance: {
        outstandingPaise: 387500,
        creditPaise: 0,
        outstandingDisplay: 'Rs 3,875.00'
      }
    });
    const details = await apiGet(
      app,
      tokens.admin,
      `/api/payments/outstanding/${customers.retailerA.id}`
    );
    expect(details.body).toMatchObject({
      invoicedPaise: 787500,
      paidPaise: 400000,
      outstandingPaise: 387500,
      invoices: [{
        id: invoice.id,
        paidPaise: 400000,
        duePaise: 387500,
        status: 'PARTIAL'
      }]
    });
    const list = await apiGet(app, tokens.admin, '/api/payments/outstanding');
    expect(list.status).toBe(200);
    expect(list.body.items.map(({ customer }) => customer.name)).toEqual(['Retailer A']);

    const audit = await db.auditLog.findFirst({
      where: { entity: 'Payment', entityId: response.body.payment.id, action: 'CREATE' }
    });
    expect(audit?.after).toMatchObject({
      receiptNo: response.body.payment.receiptNo,
      amountPaise: 400000,
      mode: 'UPI'
    });
  });

  it('counts payments without an invoice against customer outstanding', async () => {
    const response = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      amountPaise: 400000,
      mode: 'UPI',
      reference: 'UPI123456'
    });
    expect(response.status).toBe(201);
    expect(response.body.payment.invoice).toBeNull();

    const details = await apiGet(
      app,
      tokens.admin,
      `/api/payments/outstanding/${customers.retailerA.id}`
    );
    expect(details.body).toMatchObject({
      outstandingPaise: 387500,
      unallocatedPaidPaise: 400000,
      invoices: [{ paidPaise: 0, status: 'UNPAID' }]
    });
  });

  it('rejects overpayment, invoice mismatch, and payment against a cancelled invoice', async () => {
    const payment = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: invoice.id,
      amountPaise: 400000,
      mode: 'CASH'
    });
    expect(payment.status).toBe(201);

    const overpayment = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: invoice.id,
      amountPaise: 387501,
      mode: 'CASH'
    });
    expect(overpayment.status).toBe(422);
    expect(overpayment.body.error).toMatchObject({
      code: 'OVERPAYMENT',
      details: { dueSoFarPaise: 387500 }
    });

    const distributorOrder = await apiPost(app, tokens.salesmanB, '/api/orders', {
      clientRef: 'step30-dist-000001',
      customerId: customers.distributorB.id,
      lines: [{ itemId: items.finished.id, qty: 1 }]
    });
    expect(distributorOrder.status).toBe(201);
    expect((await apiPost(
      app,
      tokens.admin,
      `/api/orders/${distributorOrder.body.order.id}/approve`,
      {}
    )).status).toBe(200);
    const distributorInvoice = await apiPost(app, tokens.admin, '/api/invoices', {
      orderId: distributorOrder.body.order.id
    });
    expect(distributorInvoice.status).toBe(201);
    const mismatch = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: distributorInvoice.body.id,
      amountPaise: 1,
      mode: 'CASH'
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('INVOICE_CUSTOMER_MISMATCH');

    await db.invoice.update({
      where: { id: invoice.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Test cancellation' }
    });
    const cancelled = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: invoice.id,
      amountPaise: 1,
      mode: 'CASH'
    });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error.code).toBe('INVOICE_CANCELLED');
    const details = await apiGet(
      app,
      tokens.admin,
      `/api/payments/outstanding/${customers.retailerA.id}`
    );
    expect(details.body).toMatchObject({
      outstandingPaise: 0,
      creditPaise: 400000,
      unallocatedPaidPaise: 400000
    });
  });

  it('marks an invoice PAID after receiving its exact remaining due', async () => {
    expect((await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: invoice.id,
      amountPaise: 400000,
      mode: 'CASH'
    })).status).toBe(201);
    const final = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: invoice.id,
      amountPaise: 387500,
      mode: 'CASH'
    });
    expect(final.status).toBe(201);
    expect(final.body.customerBalance.outstandingPaise).toBe(0);
    const details = await apiGet(
      app,
      tokens.admin,
      `/api/payments/outstanding/${customers.retailerA.id}`
    );
    expect(details.body.invoices[0]).toMatchObject({
      paidPaise: 787500,
      duePaise: 0,
      status: 'PAID'
    });
  });

  it('serializes concurrent payments against one customer balance', async () => {
    const initialPayment = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: invoice.id,
      amountPaise: 400000,
      mode: 'CASH'
    });
    expect(initialPayment.status).toBe(201);
    const results = await Promise.all(Array.from({ length: 5 }, () => apiPost(
      app,
      tokens.admin,
      '/api/payments',
      {
        customerId: customers.retailerA.id,
        invoiceId: invoice.id,
        amountPaise: 100000,
        mode: 'CASH'
      }
    )));
    expect(results.filter((result) => result.status === 201)).toHaveLength(3);
    expect(results.filter((result) => result.status === 422)).toHaveLength(2);
    const details = await apiGet(
      app,
      tokens.admin,
      `/api/payments/outstanding/${customers.retailerA.id}`
    );
    expect(details.body.outstandingPaise).toBe(87500);
  });

  it('validates payment fields and enforces payment read and write roles', async () => {
    const invalidBodies = [
      { customerId: customers.retailerA.id, invoiceId: invoice.id, amountPaise: 1, mode: 'UPI' },
      { customerId: customers.retailerA.id, invoiceId: invoice.id, amountPaise: 0, mode: 'CASH' },
      { customerId: customers.retailerA.id, invoiceId: invoice.id, amountPaise: 1.5, mode: 'CASH' },
      {
        customerId: customers.retailerA.id,
        invoiceId: invoice.id,
        amountPaise: 1,
        mode: 'CASH',
        unexpected: true
      },
      {
        customerId: customers.retailerA.id,
        invoiceId: invoice.id,
        amountPaise: 1,
        mode: 'CASH',
        paymentDate: '2999-01-01T00:00:00.000Z'
      }
    ];
    for (const body of invalidBodies) {
      expect((await apiPost(app, tokens.admin, '/api/payments', body)).status).toBe(400);
    }
    expect((await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: invoice.id,
      amountPaise: 1,
      mode: 'CASH'
    })).status).toBe(201);

    expect((await apiPost(app, tokens.salesman, '/api/payments', {
      customerId: customers.retailerA.id, amountPaise: 1, mode: 'CASH'
    })).status).toBe(403);
    expect((await apiGet(app, tokens.salesman, '/api/payments')).status).toBe(403);
    expect((await apiPost(app, tokens.accountant, '/api/payments', {
      customerId: customers.retailerA.id, amountPaise: 1, mode: 'CASH'
    })).status).toBe(403);
    expect((await apiGet(app, tokens.accountant, '/api/payments')).status).toBe(200);
    expect((await apiGet(app, tokens.owner, '/api/payments')).status).toBe(200);
    expect((await request(app).get('/api/payments')).status).toBe(401);
  });

  it('filters payments by inclusive IST calendar day', async () => {
    const onDay = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: invoice.id,
      amountPaise: 1,
      mode: 'CASH',
      paymentDate: '2026-01-15T23:30:00+05:30'
    });
    const nextDay = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: invoice.id,
      amountPaise: 1,
      mode: 'CASH',
      paymentDate: '2026-01-16T00:30:00+05:30'
    });
    expect(onDay.status).toBe(201);
    expect(nextDay.status).toBe(201);
    const filtered = await apiGet(
      app,
      tokens.admin,
      `/api/payments?customerId=${customers.retailerA.id}&from=2026-01-15&to=2026-01-15`
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.map(({ id }) => id)).toEqual([onDay.body.payment.id]);
    expect(filtered.body.totalAmountPaise).toBe(1);
  });
});
