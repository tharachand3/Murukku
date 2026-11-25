import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { addMovement, getBalance } from '../src/services/ledgerService.js';
import {
  checkOrderAvailability,
  getOnHand,
  getReservedPackets
} from '../src/services/availabilityService.js';
import { apiGet, apiPost, BENCH, loginAs, seedBenchmarkMasters } from './helpers/benchmark.js';
import { db, resetDb } from './helpers/db.js';

let users;
let items;
let customers;
let tokens;
let orders;

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  const [admin, owner, production, salesmanA, salesmanB, accountant, finished, pouch, carton, retailerA, distributorB] =
    await Promise.all([
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
  const [
    adminToken,
    ownerToken,
    productionToken,
    salesmanAToken,
    salesmanBToken,
    accountantToken
  ] = await Promise.all([
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

  const retailerOrder = await apiPost(app, tokens.salesmanA, '/api/orders', {
    clientRef: 'availability-retailer-0001',
    customerId: customers.retailerA.id,
    lines: [{ itemId: items.finished.id, qty: 150 }]
  });
  const distributorOrder = await apiPost(app, tokens.salesmanB, '/api/orders', {
    clientRef: 'availability-distributor-0001',
    customerId: customers.distributorB.id,
    lines: [{ itemId: items.finished.id, qty: 120 }]
  });
  expect(retailerOrder.status).toBe(201);
  expect(distributorOrder.status).toBe(201);
  orders = {
    retailer: retailerOrder.body.order,
    distributor: distributorOrder.body.order
  };
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('finished-goods availability and reservations', () => {
  it('reports 238 packets as covering Retailer A and leaves state unchanged', async () => {
    const movementCount = await db.stockMovement.count();
    const adminResponse = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${orders.retailer.id}/availability`
    );
    const ownerResponse = await apiGet(
      app,
      tokens.owner,
      `/api/orders/${orders.retailer.id}/availability`
    );
    const salesmanResponse = await apiGet(
      app,
      tokens.salesmanA,
      `/api/orders/${orders.retailer.id}/availability`
    );

    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body).toMatchObject({
      orderId: orders.retailer.id,
      orderNo: orders.retailer.orderNo,
      status: 'SUBMITTED',
      allCovered: true,
      totalShortPackets: 0,
      message: 'Stock covers this order',
      lines: [{
        itemId: items.finished.id,
        name: 'Murukku 200 g',
        requestedQty: 150,
        effectiveQty: 150,
        onHand: BENCH.afterRun.MURUKKU200,
        reservedByOthers: 0,
        free: BENCH.afterRun.MURUKKU200,
        shortBy: 0,
        covered: true
      }]
    });
    expect(ownerResponse.status).toBe(200);
    expect(salesmanResponse.status).toBe(403);
    expect((await db.order.findUnique({
      where: { id: orders.retailer.id },
      select: { status: true }
    })).status).toBe('SUBMITTED');
    expect(await db.stockMovement.count()).toBe(movementCount);
  });

  it('reserves approved quantities, excludes the current order, and ignores non-reserving statuses', async () => {
    await db.order.update({
      where: { id: orders.retailer.id },
      data: { status: 'APPROVED' }
    });

    const distributorAvailability = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${orders.distributor.id}/availability`
    );
    expect(distributorAvailability.status).toBe(200);
    expect(distributorAvailability.body).toMatchObject({
      allCovered: false,
      totalShortPackets: 32,
      message: 'Short by 32 packets of Murukku 200 g',
      lines: [{
        requestedQty: 120,
        effectiveQty: 120,
        onHand: 238,
        reservedByOthers: 150,
        free: 88,
        shortBy: 32,
        covered: false
      }]
    });
    expect(await getReservedPackets(db, items.finished.id)).toBe(150);
    expect(await getReservedPackets(db, items.finished.id, {
      excludeOrderId: orders.retailer.id
    })).toBe(0);

    const ownAvailability = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${orders.retailer.id}/availability`
    );
    expect(ownAvailability.body.lines[0]).toMatchObject({
      reservedByOthers: 0,
      free: 238,
      shortBy: 0,
      covered: true
    });

    for (const status of ['SUBMITTED', 'REJECTED', 'CANCELLED', 'DISPATCHED']) {
      await db.order.update({
        where: { id: orders.distributor.id },
        data: { status }
      });
      expect(await getReservedPackets(db, items.finished.id, {
        excludeOrderId: orders.retailer.id
      }), status).toBe(0);
    }
    for (const status of ['APPROVED', 'INVOICED']) {
      await db.order.update({
        where: { id: orders.distributor.id },
        data: { status }
      });
      expect(await getReservedPackets(db, items.finished.id)).toBe(270);
    }
    await db.order.update({
      where: { id: orders.distributor.id },
      data: { status: 'SUBMITTED' }
    });
  });

  it('reduces reservation and on-hand equally for a partial dispatch', async () => {
    expect(await getOnHand(db, items.finished.id)).toBe(238);
    expect(await getReservedPackets(db, items.finished.id)).toBe(150);

    await db.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          invoiceNo: 'INV/2026-27/AVAIL-0001',
          financialYear: '2026-27',
          orderId: orders.retailer.id,
          customerId: customers.retailerA.id,
          issueDate: new Date('2026-11-25T00:00:00.000Z'),
          placeOfSupplyStateCode: '33',
          isInterState: false,
          taxableValuePaise: 750000,
          cgstPaise: 18750,
          sgstPaise: 18750,
          totalPaise: 787500,
          createdById: users.admin.id
        }
      });
      await tx.order.update({
        where: { id: orders.retailer.id },
        data: { status: 'INVOICED' }
      });
      const dispatch = await tx.dispatch.create({
        data: {
          dispatchNo: 'DSP/2026-27/AVAIL-0001',
          invoiceId: invoice.id,
          dispatchDate: new Date('2026-11-25T00:00:00.000Z'),
          createdById: users.admin.id
        }
      });
      await tx.dispatchLine.create({
        data: {
          dispatchId: dispatch.id,
          itemId: items.finished.id,
          qty: 100
        }
      });
      await addMovement(tx, {
        itemId: items.finished.id,
        qtyChange: -100,
        movementType: 'DISPATCH',
        sourceType: 'DISPATCH',
        sourceId: dispatch.id,
        sourceRef: dispatch.dispatchNo,
        userId: users.admin.id
      });
    });

    expect(await getOnHand(db, items.finished.id)).toBe(138);
    expect(await getReservedPackets(db, items.finished.id)).toBe(50);
    const distributorAvailability = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${orders.distributor.id}/availability`
    );
    expect(distributorAvailability.body.lines[0]).toMatchObject({
      onHand: 138,
      reservedByOthers: 50,
      free: 88,
      shortBy: 32
    });
  });

  it('keeps the legacy salesman response and adds reservation fields for stock readers', async () => {
    const adminResponse = await apiGet(
      app,
      tokens.admin,
      '/api/stock/finished-availability'
    );
    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body).toEqual([{
      itemId: items.finished.id,
      name: 'Murukku 200 g',
      availablePackets: 88,
      reservedPackets: 50,
      freePackets: 88
    }]);

    const salesmanResponse = await apiGet(
      app,
      tokens.salesmanA,
      '/api/stock/finished-availability'
    );
    expect(salesmanResponse.status).toBe(200);
    expect(salesmanResponse.body[0]).toEqual({
      itemId: items.finished.id,
      name: 'Murukku 200 g',
      availablePackets: 88
    });
  });

  it('returns 401 without a token and 403 to accountants', async () => {
    expect((await request(app)
      .get(`/api/orders/${orders.retailer.id}/availability`)).status).toBe(401);
    expect((await apiGet(
      app,
      tokens.accountant,
      `/api/orders/${orders.retailer.id}/availability`
    )).status).toBe(403);
  });
});
