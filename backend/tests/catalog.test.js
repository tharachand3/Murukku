import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { config } from '../src/config/env.js';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { getBalance } from '../src/services/ledgerService.js';
import { resolvePrice, resolvePrices } from '../src/services/pricingService.js';
import { db, resetDb } from './helpers/db.js';
import { seedBenchmarkMasters } from './helpers/benchmark.js';

let users;
let customers;
let items;

function headersFor(user) {
  const token = jwt.sign(
    { sub: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '12h' }
  );
  return { Authorization: `Bearer ${token}` };
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
  const unpricedFinished = await db.item.create({
    data: {
      code: 'NO-PRICE-FINISHED',
      name: 'Unpriced finished item',
      type: 'FINISHED',
      baseUnitId: finished.baseUnitId,
      displayUnitId: finished.displayUnitId,
      gstRateBp: finished.gstRateBp,
      packsPerCarton: finished.packsPerCarton
    }
  });
  const inactiveFinished = await db.item.create({
    data: {
      code: 'INACTIVE-FINISHED',
      name: 'Inactive finished item',
      type: 'FINISHED',
      baseUnitId: finished.baseUnitId,
      displayUnitId: finished.displayUnitId,
      gstRateBp: finished.gstRateBp,
      packsPerCarton: finished.packsPerCarton,
      sellingPricePaise: 5000,
      isActive: false
    }
  });
  const raw = await db.item.findUnique({ where: { code: 'FLOUR' } });
  const packaging = await db.item.findUnique({ where: { code: 'POUCH200' } });
  items = { finished, unpricedFinished, inactiveFinished, raw, packaging };
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('pricing resolution and salesman order catalog', () => {
  it('resolves defaults and customer prices, filters catalog items, and enforces access', async () => {
    const catalogPath = (customerId) =>
      `/api/catalog/order-items?customerId=${customerId}`;
    const unauthorized = await request(app).get(catalogPath(customers.retailerA.id));
    const accountant = await request(app)
      .get(catalogPath(customers.retailerA.id))
      .set(headersFor(users.accountant));
    const unassignedSalesman = await request(app)
      .get(catalogPath(customers.retailerA.id))
      .set(headersFor(users.salesmanB));
    const retailerAResponse = await request(app)
      .get(catalogPath(customers.retailerA.id))
      .set(headersFor(users.salesmanA));

    expect(unauthorized.status).toBe(401);
    expect(accountant.status).toBe(403);
    expect(unassignedSalesman.status).toBe(404);
    expect(unassignedSalesman.body.error.code).toBe('NOT_FOUND');
    expect(retailerAResponse.status).toBe(200);
    expect(retailerAResponse.body).toHaveLength(1);
    expect(retailerAResponse.body[0]).toMatchObject({
      itemId: items.finished.id,
      code: 'MURUKKU200',
      name: 'Murukku 200 g',
      packsPerCarton: 20,
      gstRateBp: 500,
      pricePaise: 5000,
      priceDisplay: 'Rs 50.00',
      priceSource: 'DEFAULT'
    });
    expect(retailerAResponse.body[0].availablePackets)
      .toBe(await getBalance(db, items.finished.id));
    expect(retailerAResponse.body.map(({ code }) => code))
      .not.toContain(items.raw.code);
    expect(retailerAResponse.body.map(({ code }) => code))
      .not.toContain(items.packaging.code);
    expect(retailerAResponse.body.map(({ code }) => code))
      .not.toContain(items.inactiveFinished.code);
    expect(retailerAResponse.body.map(({ code }) => code))
      .not.toContain(items.unpricedFinished.code);
    expect(JSON.stringify(retailerAResponse.body)).not.toMatch(/cost|bom/i);

    const adminCanUseDistributor = await request(app)
      .get(catalogPath(customers.distributorB.id))
      .set(headersFor(users.admin));
    expect(adminCanUseDistributor.status).toBe(200);
    expect(adminCanUseDistributor.body[0]).toMatchObject({
      pricePaise: 5000,
      priceSource: 'DEFAULT'
    });

    const savedPrice = await request(app)
      .put(`/api/customers/${customers.retailerA.id}/prices`)
      .set(headersFor(users.admin))
      .send({ prices: [{ itemId: items.finished.id, pricePaise: 4800 }] });
    expect(savedPrice.status).toBe(200);

    const [retailerACustom, distributorBDefault] = await Promise.all([
      request(app)
        .get(catalogPath(customers.retailerA.id))
        .set(headersFor(users.salesmanA)),
      request(app)
        .get(catalogPath(customers.distributorB.id))
        .set(headersFor(users.salesmanB))
    ]);
    expect(retailerACustom.body[0]).toMatchObject({
      pricePaise: 4800,
      priceDisplay: 'Rs 48.00',
      priceSource: 'CUSTOMER'
    });
    expect(distributorBDefault.body[0]).toMatchObject({
      pricePaise: 5000,
      priceDisplay: 'Rs 50.00',
      priceSource: 'DEFAULT'
    });

    await db.customer.update({
      where: { id: customers.distributorB.id },
      data: { isActive: false }
    });
    const inactiveCustomer = await request(app)
      .get(catalogPath(customers.distributorB.id))
      .set(headersFor(users.salesmanB));
    expect(inactiveCustomer.status).toBe(422);
    expect(inactiveCustomer.body.error.code).toBe('CUSTOMER_INACTIVE');

    await expect(resolvePrice(db, customers.retailerA.id, items.unpricedFinished.id))
      .rejects.toMatchObject({
        status: 422,
        code: 'NO_PRICE',
        details: { customerId: customers.retailerA.id, itemId: items.unpricedFinished.id }
      });
    await expect(resolvePrice(db, customers.retailerA.id, items.raw.id))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });

    const itemFindManyCall = db.item.findMany.bind(db.item);
    const customerPriceFindManyCall = db.customerPrice.findMany.bind(db.customerPrice);
    const itemFindMany = vi.spyOn(db.item, 'findMany')
      .mockImplementation(itemFindManyCall);
    const customerPriceFindMany = vi.spyOn(db.customerPrice, 'findMany')
      .mockImplementation(customerPriceFindManyCall);
    try {
      const prices = await resolvePrices(db, customers.retailerA.id, [
        items.finished.id,
        items.unpricedFinished.id
      ]);
      expect(prices.get(items.finished.id))
        .toEqual({ pricePaise: 4800, source: 'CUSTOMER' });
      expect(prices.has(items.unpricedFinished.id)).toBe(false);
      expect(itemFindMany).toHaveBeenCalledTimes(1);
      expect(customerPriceFindMany).toHaveBeenCalledTimes(1);
    } finally {
      itemFindMany.mockRestore();
      customerPriceFindMany.mockRestore();
    }
  });
});
