import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { apiGet, apiPost, seedBenchmarkMasters } from './helpers/benchmark.js';
import { runBenchmarkPart1 } from './helpers/benchmarkFlow.js';
import { db, resetDb } from './helpers/db.js';

const BENCH2 = Object.freeze({
  orderNo: /^ORD\/\d{4}-\d{2}\/0001$/,
  invoiceNo: /^INV\/\d{4}-\d{2}\/0001$/,
  dispatchNo: /^DSP\/\d{4}-\d{2}\/0001$/,
  receiptNo: /^RCT\/\d{4}-\d{2}\/0001$/,
  retailQty: 150,
  retailTaxablePaise: 750000,
  retailCgstPaise: 18750,
  retailSgstPaise: 18750,
  retailInvoicePaise: 787500,
  paymentPaise: 400000,
  retailOutstandingPaise: 387500,
  distributorQty: 120,
  freePackets: 88,
  shortagePackets: 32,
  interStateTaxablePaise: 600000,
  interStateIgstPaise: 30000,
  interStateInvoicePaise: 630000
});

let tokens;
let ids;
let retailerOrder;
let invoice;
let dispatch;
let distributorOrder;
let payment;

async function assertLedgerMutationRejected(movementId, operation) {
  const sentinel = 'Ledger mutation was not rejected';
  let mutationError;
  try {
    await db.$transaction(async (tx) => {
      await operation(tx, movementId);
      throw new Error(sentinel);
    });
  } catch (error) {
    if (error.message === sentinel) {
      throw error;
    }
    mutationError = error;
  }
  expect(mutationError).toBeDefined();
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  ({ tokens, ids } = await runBenchmarkPart1(app));
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('sales benchmark steps 4 to 7 through the public API', () => {
  it('step 4: submits a priced Retailer A order without changing stock', async () => {
    const movementCount = await db.stockMovement.count();
    const response = await apiPost(app, tokens.salesmanA, '/api/orders', {
      clientRef: 'benchmark-retailer-a-0001',
      customerId: ids.retailerA,
      lines: [{ itemId: ids.items.MURUKKU200.id, qty: BENCH2.retailQty }]
    });

    expect(response.status).toBe(201);
    retailerOrder = response.body.order;
    expect(retailerOrder).toMatchObject({
      orderNo: expect.stringMatching(BENCH2.orderNo),
      status: 'SUBMITTED',
      lines: [{
        itemId: ids.items.MURUKKU200.id,
        qty: BENCH2.retailQty,
        pricePaise: 5000,
        lineTotalPaise: BENCH2.retailTaxablePaise
      }],
      taxableTotalPaise: BENCH2.retailTaxablePaise
    });
    expect(await db.stockMovement.count()).toBe(movementCount);

    const stock = await apiGet(app, tokens.admin, '/api/stock/summary');
    expect(stock.status).toBe(200);
    expect(stock.body.find(({ code }) => code === 'MURUKKU200').balanceBase).toBe(238);
  });

  it('step 5: approves, invoices, and dispatches Retailer A with CGST and SGST', async () => {
    const approval = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${retailerOrder.id}/approve`,
      {}
    );
    expect(approval.status).toBe(200);
    expect(approval.body.status).toBe('APPROVED');

    const availability = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${retailerOrder.id}/availability`
    );
    expect(availability.status).toBe(200);
    expect(availability.body.allCovered).toBe(true);

    const invoiceResponse = await apiPost(app, tokens.admin, '/api/invoices', {
      orderId: retailerOrder.id
    });
    expect(invoiceResponse.status).toBe(201);
    invoice = invoiceResponse.body;
    expect(invoice.invoiceNo).toMatch(BENCH2.invoiceNo);
    expect(invoice).toMatchObject({
      isInterState: false,
      taxableValuePaise: BENCH2.retailTaxablePaise,
      cgstPaise: BENCH2.retailCgstPaise,
      sgstPaise: BENCH2.retailSgstPaise,
      igstPaise: 0,
      totalPaise: BENCH2.retailInvoicePaise,
      lines: [{
        ratePaise: 5000,
        hsnCode: '21069099',
        gstRateBp: 500
      }]
    });

    const dispatchResponse = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id
    });
    expect(dispatchResponse.status).toBe(201);
    dispatch = dispatchResponse.body.dispatch;
    expect(dispatch.dispatchNo).toMatch(BENCH2.dispatchNo);

    const [orderDetails, stock, dispatchRows] = await Promise.all([
      apiGet(app, tokens.admin, `/api/orders/${retailerOrder.id}`),
      apiGet(app, tokens.admin, '/api/stock/summary'),
      db.stockMovement.findMany({
        where: { sourceType: 'DISPATCH' },
        orderBy: { id: 'asc' }
      })
    ]);
    expect(orderDetails.status).toBe(200);
    expect(orderDetails.body.status).toBe('DISPATCHED');
    expect(stock.status).toBe(200);
    const balances = Object.fromEntries(stock.body.map(({ code, balanceBase }) => [code, balanceBase]));
    expect(balances).toMatchObject({
      FLOUR: 120000,
      OIL: 19500,
      SPICE: 3800,
      POUCH200: 306,
      CARTON: 21,
      MURUKKU200: BENCH2.freePackets
    });
    expect(dispatchRows).toHaveLength(1);
    expect(dispatchRows[0]).toMatchObject({
      itemId: ids.items.MURUKKU200.id,
      qtyChange: -BENCH2.retailQty,
      sourceRef: dispatch.dispatchNo
    });

    const allMovements = await db.stockMovement.findMany();
    expect(allMovements.every(({ sourceType }) => sourceType !== null)).toBe(true);
    const ledgerTotals = await db.stockMovement.groupBy({
      by: ['itemId'],
      _sum: { qtyChange: true }
    });
    const totalByItemId = new Map(
      ledgerTotals.map(({ itemId, _sum }) => [itemId, _sum.qtyChange ?? 0])
    );
    for (const row of stock.body) {
      expect(totalByItemId.get(row.itemId) ?? 0).toBe(row.balanceBase);
    }

    const movement = dispatchRows[0];
    await assertLedgerMutationRejected(movement.id, (tx, id) =>
      tx.$executeRaw`UPDATE "StockMovement" SET "qtyChange" = "qtyChange" WHERE id = ${id}`
    );
    await assertLedgerMutationRejected(movement.id, (tx, id) =>
      tx.$executeRaw`DELETE FROM "StockMovement" WHERE id = ${id}`
    );
  });

  it('step 6: reports Distributor B shortage and proves the real IGST preview', async () => {
    const response = await apiPost(app, tokens.salesmanB, '/api/orders', {
      clientRef: 'benchmark-distributor-b-0001',
      customerId: ids.distributorB,
      lines: [{ itemId: ids.items.MURUKKU200.id, qty: BENCH2.distributorQty }]
    });
    expect(response.status).toBe(201);
    distributorOrder = response.body.order;
    expect(distributorOrder.status).toBe('SUBMITTED');

    const [availability, shortages, invoicePreview] = await Promise.all([
      apiGet(app, tokens.admin, `/api/orders/${distributorOrder.id}/availability`),
      apiGet(app, tokens.admin, '/api/orders/shortages'),
      apiGet(app, tokens.admin, `/api/orders/${distributorOrder.id}/invoice-preview`)
    ]);
    expect(availability.status).toBe(200);
    expect(availability.body).toMatchObject({
      allCovered: false,
      totalShortPackets: BENCH2.shortagePackets,
      message: 'Short by 32 packets of Murukku 200 g',
      lines: [{
        onHand: BENCH2.freePackets,
        free: BENCH2.freePackets,
        shortBy: BENCH2.shortagePackets
      }]
    });
    expect(shortages.status).toBe(200);
    expect(shortages.body).toMatchObject({
      totalShortPackets: BENCH2.shortagePackets,
      items: [{
        totalShortPackets: BENCH2.shortagePackets,
        suggestedBatches: 1,
        orders: [{
          orderId: distributorOrder.id,
          qty: BENCH2.distributorQty,
          allocated: BENCH2.freePackets,
          shortBy: BENCH2.shortagePackets
        }]
      }]
    });

    const approval = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${distributorOrder.id}/approve`,
      {}
    );
    expect(approval.status).toBe(409);
    expect(approval.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { lines: [{ shortBy: BENCH2.shortagePackets }] }
    });
    expect((await db.order.findUnique({
      where: { id: distributorOrder.id },
      select: { status: true, invoice: { select: { id: true } } }
    }))).toMatchObject({ status: 'SUBMITTED', invoice: null });
    expect(await db.stockMovement.count({ where: { sourceType: 'DISPATCH' } })).toBe(1);

    expect(invoicePreview.status).toBe(200);
    expect(invoicePreview.body).toMatchObject({
      isInterState: true,
      placeOfSupplyStateCode: '29',
      totals: {
        taxableValuePaise: BENCH2.interStateTaxablePaise,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: BENCH2.interStateIgstPaise,
        totalPaise: BENCH2.interStateInvoicePaise
      }
    });
  });

  it('isolates salesman reads and protects invoice, dispatch, and payment writes by role', async () => {
    expect((await apiGet(
      app,
      tokens.salesmanA,
      `/api/orders/${distributorOrder.id}`
    )).status).toBe(404);

    const sales = await apiGet(app, tokens.salesmanA, '/api/orders/my/customer-sales');
    expect(sales.status).toBe(200);
    expect(sales.body.items).toMatchObject([{
      customerName: 'Retailer A',
      totalQty: BENCH2.retailQty,
      taxableValuePaise: BENCH2.retailTaxablePaise
    }]);

    expect((await apiPost(app, tokens.salesmanA, '/api/invoices', {
      orderId: retailerOrder.id
    })).status).toBe(403);
    expect((await apiPost(app, tokens.salesmanA, '/api/dispatches', {
      invoiceId: invoice.id
    })).status).toBe(403);
    expect((await apiPost(app, tokens.salesmanA, '/api/payments', {
      customerId: ids.retailerA,
      invoiceId: invoice.id,
      amountPaise: 1,
      mode: 'CASH'
    })).status).toBe(403);

    const [orders, invoices, payments] = await Promise.all([
      apiGet(app, tokens.accountant, '/api/orders'),
      apiGet(app, tokens.accountant, '/api/invoices'),
      apiGet(app, tokens.accountant, '/api/payments')
    ]);
    expect([orders.status, invoices.status, payments.status]).toEqual([200, 200, 200]);
    expect((await apiPost(app, tokens.accountant, '/api/invoices', {
      orderId: retailerOrder.id
    })).status).toBe(403);
    expect((await apiPost(app, tokens.accountant, '/api/dispatches', {
      invoiceId: invoice.id
    })).status).toBe(403);
    expect((await apiPost(app, tokens.accountant, '/api/payments', {
      customerId: ids.retailerA,
      invoiceId: invoice.id,
      amountPaise: 1,
      mode: 'CASH'
    })).status).toBe(403);
    expect((await request(app).get('/api/payments')).status).toBe(401);
  });

  it('step 7: records payment, checks outstanding, audit, and duplicate/overpayment errors', async () => {
    const response = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: ids.retailerA,
      invoiceId: invoice.id,
      amountPaise: BENCH2.paymentPaise,
      mode: 'UPI',
      reference: 'UPI123456'
    });
    expect(response.status).toBe(201);
    payment = response.body.payment;
    expect(payment.receiptNo).toMatch(BENCH2.receiptNo);
    expect(response.body.customerBalance).toMatchObject({
      outstandingPaise: BENCH2.retailOutstandingPaise,
      outstandingDisplay: 'Rs 3,875.00'
    });

    const [retailerBalance, distributorBalance, outstanding, invoiceReads] = await Promise.all([
      apiGet(app, tokens.admin, `/api/payments/outstanding/${ids.retailerA}`),
      apiGet(app, tokens.admin, `/api/payments/outstanding/${ids.distributorB}`),
      apiGet(app, tokens.admin, '/api/payments/outstanding'),
      apiGet(app, tokens.accountant, '/api/invoices')
    ]);
    expect(retailerBalance.status).toBe(200);
    expect(retailerBalance.body).toMatchObject({
      outstandingPaise: BENCH2.retailOutstandingPaise,
      invoices: [{
        id: invoice.id,
        paidPaise: BENCH2.paymentPaise,
        duePaise: BENCH2.retailOutstandingPaise,
        status: 'PARTIAL'
      }]
    });
    expect(distributorBalance.status).toBe(200);
    expect(distributorBalance.body).toMatchObject({
      invoicedPaise: 0,
      outstandingPaise: 0,
      invoices: []
    });
    expect(outstanding.status).toBe(200);
    expect(outstanding.body.items.map(({ customer }) => customer.name)).toEqual(['Retailer A']);

    const [secondDispatch, secondInvoice, overpayment] = await Promise.all([
      apiPost(app, tokens.admin, '/api/dispatches', { invoiceId: invoice.id }),
      apiPost(app, tokens.admin, '/api/invoices', { orderId: retailerOrder.id }),
      apiPost(app, tokens.admin, '/api/payments', {
        customerId: ids.retailerA,
        invoiceId: invoice.id,
        amountPaise: BENCH2.retailOutstandingPaise + 1,
        mode: 'CASH'
      })
    ]);
    expect(secondDispatch.status).toBe(409);
    expect(secondDispatch.body.error.code).toBe('ALREADY_DISPATCHED');
    expect(secondInvoice.status).toBe(409);
    expect(secondInvoice.body.error.code).toBe('ALREADY_INVOICED');
    expect(overpayment.status).toBe(422);
    expect(overpayment.body.error).toMatchObject({
      code: 'OVERPAYMENT',
      details: { dueSoFarPaise: BENCH2.retailOutstandingPaise }
    });

    const orderAudits = await db.auditLog.findMany({
      where: { entity: 'Order', entityId: retailerOrder.id }
    });
    expect(orderAudits.some(({ action }) => action === 'CREATE')).toBe(true);
    expect(orderAudits.some(({ after }) => after?.status === 'APPROVED')).toBe(true);
    for (const [entity, entityId] of [
      ['Invoice', invoice.id],
      ['Dispatch', dispatch.id],
      ['Payment', payment.id]
    ]) {
      expect(await db.auditLog.findFirst({
        where: { entity, entityId, action: 'CREATE' }
      })).not.toBeNull();
    }
    expect(await db.invoice.count({ where: { customerId: ids.distributorB } })).toBe(0);
    expect((await db.order.findUnique({
      where: { id: distributorOrder.id },
      select: { status: true }
    })).status).toBe('SUBMITTED');
    expect(invoiceReads.status).toBe(200);
  });
});
