import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { currentFinancialYear } from '../src/lib/fy.js';
import { formatIstDate } from '../src/lib/reportKit.js';
import { prisma } from '../src/lib/prisma.js';
import { apiGet, apiPost, seedBenchmarkMasters } from './helpers/benchmark.js';
import { cancelInvoiceViaApi } from './helpers/benchmarkExtras.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { db, resetDb } from './helpers/db.js';

function getSection(response, key) {
  return response.body.sections.find((section) => section.key === key);
}

async function createDistributorInvoice(context) {
  const order = await apiGet(app, context.tokens.admin, `/api/orders/${context.ids.orderB}`);
  const approval = await apiPost(
    app,
    context.tokens.admin,
    `/api/orders/${context.ids.orderB}/approve`,
    { lines: [{ lineId: order.body.lines[0].lineId, approvedQty: 88 }] }
  );
  expect(approval.status).toBe(200);
  const response = await apiPost(app, context.tokens.admin, '/api/invoices', {
    orderId: context.ids.orderB
  });
  expect(response.status).toBe(201);
  return response.body.id;
}

let benchmark;
let distributorInvoiceId;
const fy = currentFinancialYear();

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  benchmark = await runBenchmarkFull(app);
}, 120000);

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('customer and product sales reports', () => {
  it('shows benchmark customer and product totals, snapshots, and role access', async () => {
    const [customers, products] = await Promise.all([
      apiGet(app, benchmark.tokens.accountant, '/api/reports/sales-by-customer'),
      apiGet(app, benchmark.tokens.accountant, '/api/reports/sales-by-product')
    ]);
    expect(customers.status).toBe(200);
    expect(products.status).toBe(200);
    expect(getSection(customers, 'customers').rows).toEqual([{
      customerName: 'Retailer A',
      customerType: 'RETAILER',
      customerGstin: '33AAAAA0000A1Z5',
      stateName: 'Tamil Nadu',
      invoices: 1,
      qty: 150,
      taxableValuePaise: 750000,
      taxPaise: 37500,
      totalPaise: 787500,
      avgInvoicePaise: 787500,
      sharePctBp: 10000,
      lastInvoiceDate: formatIstDate(new Date())
    }]);
    expect(getSection(products, 'products').rows).toEqual([{
      itemCode: 'MURUKKU200',
      itemName: 'Murukku 200 g',
      hsnCode: '21069099',
      unit: 'packet',
      invoices: 1,
      qty: 150,
      taxableValuePaise: 750000,
      avgRatePaise: 5000,
      taxPaise: 37500,
      totalPaise: 787500,
      sharePctBp: 10000
    }]);
    expect(getSection(customers, 'customers').totals).toMatchObject({
      invoices: 1, qty: 150, totalPaise: 787500, sharePctBp: 10000
    });

    for (const role of ['admin', 'accountant', 'owner']) {
      const [customerReport, productReport] = await Promise.all([
        apiGet(app, benchmark.tokens[role], '/api/reports/sales-by-customer'),
        apiGet(app, benchmark.tokens[role], '/api/reports/sales-by-product')
      ]);
      expect(customerReport.status).toBe(200);
      expect(productReport.status).toBe(200);
    }
    for (const role of ['salesmanA', 'production']) {
      expect((await apiGet(
        app,
        benchmark.tokens[role],
        '/api/reports/sales-by-product'
      )).status).toBe(403);
    }
    expect((await request(app).get('/api/reports/sales-by-customer')).status).toBe(401);
  });

  it('reports both customers and product invoice counts with filtered shares', async () => {
    distributorInvoiceId = await createDistributorInvoice(benchmark);
    const [customers, products, distributors, byCustomer] = await Promise.all([
      apiGet(app, benchmark.tokens.accountant, '/api/reports/sales-by-customer'),
      apiGet(app, benchmark.tokens.accountant, '/api/reports/sales-by-product'),
      apiGet(app, benchmark.tokens.accountant, '/api/reports/sales-by-customer?customerType=DISTRIBUTOR'),
      apiGet(
        app,
        benchmark.tokens.accountant,
        `/api/reports/sales-by-customer?customerId=${benchmark.ids.retailerA}`
      )
    ]);
    expect(getSection(customers, 'customers').rows.map((row) => [
      row.customerName,
      row.totalPaise,
      row.sharePctBp
    ])).toEqual([
      ['Retailer A', 787500, 6303],
      ['Distributor B', 462000, 3697]
    ]);
    expect(getSection(customers, 'customers').rows[1]).toMatchObject({
      invoices: 1,
      qty: 88,
      taxableValuePaise: 440000,
      taxPaise: 22000,
      totalPaise: 462000
    });
    expect(getSection(products, 'products').rows[0]).toMatchObject({
      invoices: 2,
      qty: 238,
      taxableValuePaise: 1190000,
      avgRatePaise: 5000,
      taxPaise: 59500,
      totalPaise: 1249500,
      sharePctBp: 10000
    });
    expect(getSection(distributors, 'customers').rows).toHaveLength(1);
    expect(getSection(distributors, 'customers').rows[0].sharePctBp).toBe(10000);
    expect(getSection(byCustomer, 'customers').rows.map(({ customerName }) => customerName))
      .toEqual(['Retailer A']);

    const catalog = await apiGet(app, benchmark.tokens.accountant, '/api/reports');
    expect(catalog.body.map(({ key }) => key)).toEqual(expect.arrayContaining([
      'sales-by-customer',
      'sales-by-product'
    ]));
  });

  it('uses invoice-line snapshots after item master data changes', async () => {
    await prisma.item.update({
      where: { id: benchmark.ids.murukku },
      data: { name: 'Renamed item', hsnCode: '99999999' }
    });
    const products = await apiGet(app, benchmark.tokens.accountant, '/api/reports/sales-by-product');
    expect(getSection(products, 'products').rows[0]).toMatchObject({
      itemName: 'Murukku 200 g',
      hsnCode: '21069099'
    });
  });

  it('excludes cancelled invoices and summarizes only matching posted data', async () => {
    await cancelInvoiceViaApi(app, benchmark, distributorInvoiceId);
    const [customers, products, distributors] = await Promise.all([
      apiGet(app, benchmark.tokens.accountant, '/api/reports/sales-by-customer'),
      apiGet(app, benchmark.tokens.accountant, '/api/reports/sales-by-product'),
      apiGet(app, benchmark.tokens.accountant, '/api/reports/sales-by-customer?customerType=DISTRIBUTOR')
    ]);
    expect(getSection(customers, 'customers').rows.map(({ customerName }) => customerName))
      .toEqual(['Retailer A']);
    expect(getSection(products, 'products').rows[0]).toMatchObject({
      invoices: 1,
      qty: 150,
      totalPaise: 787500
    });
    expect(getSection(distributors, 'customers').rows).toEqual([]);
    expect(getSection(distributors, 'customers').totals.totalPaise).toBe(0);
  });

  it('returns empty periods and applies IST calendar-day boundaries', async () => {
    const today = formatIstDate(new Date());
    const yesterdayDate = new Date(`${today}T00:00:00.000Z`);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 3);
    const outside = formatIstDate(yesterdayDate);
    const empty = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/sales-by-customer?from=${outside}&to=${outside}`
    );
    const emptyProduct = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/sales-by-product?from=${outside}&to=${outside}`
    );
    expect(getSection(empty, 'customers').rows).toEqual([]);
    expect(getSection(empty, 'customers').totals).toMatchObject({
      invoices: 0, qty: 0, totalPaise: 0
    });
    expect(getSection(emptyProduct, 'products').rows).toEqual([]);
    expect(getSection(emptyProduct, 'products').totals).toMatchObject({
      invoices: 0, qty: 0, totalPaise: 0
    });
    const invalid = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/sales-by-product?unexpected=true`
    );
    expect(invalid.status).toBe(400);

    const tomorrowDate = new Date(`${today}T00:00:00.000Z`);
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    const tomorrow = formatIstDate(tomorrowDate);
    const retailer = await db.customer.findUnique({
      where: { id: benchmark.ids.retailerA },
      select: { id: true }
    });
    const admin = await db.user.findUnique({
      where: { email: 'admin@demo.com' },
      select: { id: true }
    });
    const item = await db.item.findUnique({
      where: { id: benchmark.ids.murukku },
      select: { id: true }
    });
    const fixtureBase = {
      financialYear: fy,
      customerId: retailer.id,
      placeOfSupplyStateCode: '33',
      isInterState: false,
      taxableValuePaise: 100,
      cgstPaise: 3,
      sgstPaise: 3,
      totalPaise: 106,
      createdById: admin.id
    };
    const beforeEdge = await prisma.invoice.create({
      data: {
        ...fixtureBase,
        invoiceNo: `STEP38-LATE-${fy}`,
        issueDate: new Date(`${today}T23:30:00+05:30`),
        lines: {
          create: {
            itemId: item.id,
            description: 'Murukku 200 g',
            hsnCode: '21069099',
            qty: 1,
            ratePaise: 100,
            taxableValuePaise: 100,
            gstRateBp: 500,
            cgstPaise: 3,
            sgstPaise: 3,
            igstPaise: 0,
            totalPaise: 106
          }
        }
      }
    });
    const afterEdge = await prisma.invoice.create({
      data: {
        ...fixtureBase,
        invoiceNo: `STEP38-EARLY-${fy}`,
        issueDate: new Date(`${tomorrow}T00:30:00+05:30`),
        lines: {
          create: {
            itemId: item.id,
            description: 'Murukku 200 g',
            hsnCode: '21069099',
            qty: 1,
            ratePaise: 100,
            taxableValuePaise: 100,
            gstRateBp: 500,
            cgstPaise: 3,
            sgstPaise: 3,
            igstPaise: 0,
            totalPaise: 106
          }
        }
      }
    });
    const lastDay = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/sales-by-product?from=${today}&to=${today}`
    );
    expect(getSection(lastDay, 'products').rows[0]).toMatchObject({
      itemName: 'Murukku 200 g',
      qty: 151
    });
    const lastDayCustomers = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/sales-by-customer?from=${today}&to=${today}`
    );
    expect(getSection(lastDayCustomers, 'customers').rows[0].qty).toBe(151);
    const nextDay = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/sales-by-product?from=${tomorrow}&to=${tomorrow}`
    );
    expect(getSection(nextDay, 'products').rows[0]).toMatchObject({
      itemName: 'Murukku 200 g',
      qty: 1
    });
    const nextDayCustomers = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/sales-by-customer?from=${tomorrow}&to=${tomorrow}`
    );
    expect(getSection(nextDayCustomers, 'customers').rows[0].qty).toBe(1);
    expect(beforeEdge.id).toBeGreaterThan(0);
    expect(afterEdge.id).toBeGreaterThan(beforeEdge.id);
  });
});
