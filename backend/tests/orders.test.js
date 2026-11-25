import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { config } from '../src/config/env.js';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { db, resetDb } from './helpers/db.js';
import { seedBenchmarkMasters } from './helpers/benchmark.js';

let users;
let customers;
let items;
let headers;

function tokenHeaders(user) {
  const token = jwt.sign(
    { sub: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '12h' }
  );
  return { Authorization: `Bearer ${token}` };
}

function postOrder(token, body) {
  const call = request(app).post('/api/orders');
  if (token) {
    call.set('Authorization', `Bearer ${token}`);
  }
  return call.send(body);
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  const [admin, salesmanA, salesmanB, accountant, retailerA, distributorB, finished] =
    await Promise.all([
      db.user.findUnique({ where: { email: 'admin@demo.com' } }),
      db.user.findUnique({ where: { email: 'salesman.a@demo.com' } }),
      db.user.findUnique({ where: { email: 'salesman.b@demo.com' } }),
      db.user.findUnique({ where: { email: 'accountant@demo.com' } }),
      db.customer.findFirst({ where: { name: 'Retailer A' } }),
      db.customer.findFirst({ where: { name: 'Distributor B' } }),
      db.item.findUnique({ where: { code: 'MURUKKU200' } })
    ]);
  users = { admin, salesmanA, salesmanB, accountant };
  customers = { retailerA, distributorB };
  const flour = await db.item.findUnique({ where: { code: 'FLOUR' } });
  items = {
    finished,
    raw: flour,
    noStockFinished: await db.item.create({
      data: {
        code: 'NO-STOCK-FINISHED',
        name: 'Finished item with no stock',
        type: 'FINISHED',
        baseUnitId: finished.baseUnitId,
        displayUnitId: finished.displayUnitId,
        gstRateBp: finished.gstRateBp,
        packsPerCarton: finished.packsPerCarton,
        sellingPricePaise: 5000
      }
    })
  };
  headers = {
    admin: tokenHeaders(admin),
    salesmanA: tokenHeaders(salesmanA),
    salesmanB: tokenHeaders(salesmanB),
    accountant: tokenHeaders(accountant)
  };
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('salesman order creation', () => {
  it('prices, merges, and idempotently creates orders without changing stock', async () => {
    const benchmarkRequest = {
      clientRef: 'test-0001-abcd',
      customerId: customers.retailerA.id,
      lines: [
        { itemId: items.finished.id, qty: 70 },
        { itemId: items.finished.id, qty: 80 }
      ]
    };
    const created = await postOrder(headers.salesmanA.Authorization.slice(7), benchmarkRequest);
    expect(created.status).toBe(201);
    expect(created.body.duplicate).toBe(false);
    expect(created.body.order.orderNo).toMatch(/^ORD\/\d{4}-\d{2}\/0001$/);
    expect(created.body.order).toMatchObject({
      clientRef: benchmarkRequest.clientRef,
      status: 'SUBMITTED',
      customer: { id: customers.retailerA.id, name: 'Retailer A' },
      taxableTotalPaise: 750000,
      totalDisplay: '7,500.00',
      lines: [{
        itemId: items.finished.id,
        name: 'Murukku 200 g',
        qty: 150,
        pricePaise: 5000,
        priceDisplay: 'Rs 50.00',
        lineTotalPaise: 750000
      }]
    });
    expect(created.body.order.lines).toHaveLength(1);
    const orderId = created.body.order.id;
    const storedOrder = await db.order.findUnique({
      where: { id: orderId },
      select: { salesmanId: true, status: true, lines: { select: {
        approvedQty: true,
        approvedPricePaise: true
      } } }
    });
    expect(storedOrder).toMatchObject({
      salesmanId: users.salesmanA.id,
      status: 'SUBMITTED',
      lines: [{ approvedQty: null, approvedPricePaise: null }]
    });
    const duplicate = await postOrder(headers.salesmanA.Authorization.slice(7), benchmarkRequest);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
    expect(duplicate.body.order).toEqual(created.body.order);
    expect(await db.order.count({ where: { clientRef: benchmarkRequest.clientRef } })).toBe(1);

    const nextOrder = await postOrder(headers.salesmanA.Authorization.slice(7), {
      clientRef: 'test-0002-abcd',
      customerId: customers.retailerA.id,
      lines: [{ itemId: items.finished.id, qty: 1 }]
    });
    expect(nextOrder.status).toBe(201);
    expect(nextOrder.body.order.orderNo).toMatch(/^ORD\/\d{4}-\d{2}\/0002$/);

    const savedPrice = await request(app)
      .put(`/api/customers/${customers.retailerA.id}/prices`)
      .set(headers.admin)
      .send({ prices: [{ itemId: items.finished.id, pricePaise: 4800 }] });
    expect(savedPrice.status).toBe(200);
    const duplicateAfterPriceChange = await postOrder(
      headers.salesmanA.Authorization.slice(7),
      benchmarkRequest
    );
    expect(duplicateAfterPriceChange.status).toBe(200);
    expect(duplicateAfterPriceChange.body).toMatchObject({
      duplicate: true,
      order: created.body.order
    });
    const customerPricedOrder = await postOrder(headers.salesmanA.Authorization.slice(7), {
      clientRef: 'custom-price-0001',
      customerId: customers.retailerA.id,
      lines: [{ itemId: items.finished.id, qty: 1 }]
    });
    expect(customerPricedOrder.status).toBe(201);
    expect(customerPricedOrder.body.order.lines[0]).toMatchObject({
      pricePaise: 4800,
      lineTotalPaise: 4800
    });

    const conflict = await postOrder(headers.salesmanB.Authorization.slice(7), {
      ...benchmarkRequest,
      customerId: customers.distributorB.id
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('CLIENT_REF_TAKEN');
    const unassignedCustomer = await postOrder(headers.salesmanB.Authorization.slice(7), {
      clientRef: 'unassigned-0001',
      customerId: customers.retailerA.id,
      lines: [{ itemId: items.finished.id, qty: 1 }]
    });
    expect(unassignedCustomer.status).toBe(404);
    expect(unassignedCustomer.body.error.code).toBe('NOT_FOUND');

    await db.customer.update({
      where: { id: customers.distributorB.id },
      data: { isActive: false }
    });
    const inactiveCustomer = await postOrder(headers.salesmanB.Authorization.slice(7), {
      clientRef: 'inactive-000001',
      customerId: customers.distributorB.id,
      lines: [{ itemId: items.finished.id, qty: 1 }]
    });
    expect(inactiveCustomer.status).toBe(422);
    expect(inactiveCustomer.body.error.code).toBe('CUSTOMER_INACTIVE');

    const rawItem = await postOrder(headers.salesmanA.Authorization.slice(7), {
      clientRef: 'raw-item-000001',
      customerId: customers.retailerA.id,
      lines: [{ itemId: items.raw.id, qty: 1 }]
    });
    expect(rawItem.status).toBe(422);
    expect(rawItem.body.error.code).toBe('ITEM_NOT_ORDERABLE');

    const invalidBodies = [
      {
        clientRef: 'invalid-qtyzero',
        customerId: customers.retailerA.id,
        lines: [{ itemId: items.finished.id, qty: 0 }]
      },
      {
        clientRef: 'invalid-qtyfrac',
        customerId: customers.retailerA.id,
        lines: [{ itemId: items.finished.id, qty: 1.5 }]
      },
      {
        clientRef: 'invalid-empty',
        customerId: customers.retailerA.id,
        lines: []
      },
      {
        clientRef: 'invalid-51lines',
        customerId: customers.retailerA.id,
        lines: Array.from({ length: 51 }, () => ({
          itemId: items.finished.id,
          qty: 1
        }))
      },
      {
        clientRef: 'invalid-price',
        customerId: customers.retailerA.id,
        lines: [{ itemId: items.finished.id, qty: 1, pricePaise: 5000 }]
      }
    ];
    const orderCountBeforeInvalid = await db.order.count();
    for (const body of invalidBodies) {
      const response = await postOrder(headers.salesmanA.Authorization.slice(7), body);
      expect(response.status, body.clientRef).toBe(400);
    }
    expect(await db.order.count()).toBe(orderCountBeforeInvalid);

    const adminCreate = await postOrder(headers.admin.Authorization.slice(7), benchmarkRequest);
    const unauthenticated = await postOrder(null, benchmarkRequest);
    expect(adminCreate.status).toBe(403);
    expect(unauthenticated.status).toBe(401);

    const movementsBeforeLargeOrder = await db.stockMovement.count();
    expect(await db.stockMovement.count({
      where: { itemId: items.noStockFinished.id }
    })).toBe(0);
    const largeOrder = await postOrder(headers.salesmanA.Authorization.slice(7), {
      clientRef: 'large-stockless-0001',
      customerId: customers.retailerA.id,
      lines: [{ itemId: items.noStockFinished.id, qty: 100000 }]
    });
    expect(largeOrder.status).toBe(201);
    expect(largeOrder.body.order.lines[0].qty).toBe(100000);
    expect(await db.stockMovement.count()).toBe(movementsBeforeLargeOrder);
    expect(await db.stockMovement.count({
      where: { itemId: items.noStockFinished.id }
    })).toBe(0);

    const parallelBody = {
      clientRef: 'parallel-ref-0001',
      customerId: customers.retailerA.id,
      lines: [{ itemId: items.finished.id, qty: 1 }]
    };
    const parallelResponses = await Promise.all(
      Array.from({ length: 5 }, () =>
        postOrder(headers.salesmanA.Authorization.slice(7), parallelBody)
      )
    );
    expect(parallelResponses.every(({ status }) => [200, 201].includes(status))).toBe(true);
    const parallelOrderIds = new Set(
      parallelResponses.map(({ body }) => body.order.id)
    );
    expect(parallelOrderIds.size).toBe(1);
    expect(parallelResponses.filter(({ status }) => status === 201)).toHaveLength(1);
    expect(parallelResponses.every(({ body, status }) => body.duplicate === (status === 200)))
      .toBe(true);
    expect(await db.order.count({ where: { clientRef: parallelBody.clientRef } })).toBe(1);

    const audit = await db.auditLog.findFirst({
      where: { entity: 'Order', entityId: orderId }
    });
    expect(audit).toMatchObject({
      action: 'CREATE',
      after: {
        orderNo: created.body.order.orderNo,
        lines: [{ qty: 150, pricePaise: 5000 }]
      }
    });
  });
});
