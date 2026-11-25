import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { formatIstDate } from '../src/lib/reportKit.js';
import { prisma } from '../src/lib/prisma.js';
import { apiGet, apiPost, seedBenchmarkMasters } from './helpers/benchmark.js';
import { cancelInvoiceViaApi } from './helpers/benchmarkExtras.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { db, resetDb } from './helpers/db.js';

function getSection(response, key) {
  return response.body.sections.find((section) => section.key === key);
}

function istDate(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createDistributorInvoice(appInstance, context) {
  const order = await apiGet(
    appInstance,
    context.tokens.admin,
    `/api/orders/${context.ids.orderB}`
  );
  expect(order.status).toBe(200);
  const approval = await apiPost(
    appInstance,
    context.tokens.admin,
    `/api/orders/${context.ids.orderB}/approve`,
    { lines: [{ lineId: order.body.lines[0].lineId, approvedQty: 88 }] }
  );
  expect(approval.status).toBe(200);
  const invoice = await apiPost(appInstance, context.tokens.admin, '/api/invoices', {
    orderId: context.ids.orderB
  });
  expect(invoice.status).toBe(201);
  return invoice.body.id;
}

let benchmark;

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  benchmark = await runBenchmarkFull(app);
}, 120000);

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('sales register report', () => {
  it('returns benchmark invoice, posted totals, and the cancelled summary row', async () => {
    const response = await apiGet(app, benchmark.tokens.accountant, '/api/reports/sales-register');
    expect(response.status).toBe(200);
    expect(response.body.report).toMatchObject({
      key: 'sales-register',
      title: 'Sales Register',
      group: 'sales'
    });
    expect(response.body.generatedAt).toEqual(expect.any(String));
    expect(new Date(response.body.generatedAt).toISOString()).toBe(response.body.generatedAt);
    expect(getSection(response, 'invoices').rows).toEqual([{
      invoiceNo: `INV/${benchmark.FY}/0001`,
      issueDate: expect.any(String),
      customerName: 'Retailer A',
      customerGstin: '33AAAAA0000A1Z5',
      placeOfSupply: '33-Tamil Nadu',
      taxType: 'CGST+SGST',
      qty: 150,
      taxableValuePaise: 750000,
      cgstPaise: 18750,
      sgstPaise: 18750,
      igstPaise: 0,
      totalPaise: 787500,
      status: 'POSTED',
      creditNoteNo: null
    }]);
    expect(getSection(response, 'invoices').totals).toMatchObject({
      taxableValuePaise: 750000,
      cgstPaise: 18750,
      sgstPaise: 18750,
      igstPaise: 0,
      totalPaise: 787500
    });
    expect(getSection(response, 'summary').rows).toEqual([
      {
        label: 'Net sales (posted invoices)',
        invoices: 1,
        taxableValuePaise: 750000,
        cgstPaise: 18750,
        sgstPaise: 18750,
        igstPaise: 0,
        totalPaise: 787500
      },
      {
        label: 'Cancelled by credit note (not counted)',
        invoices: 0,
        taxableValuePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        totalPaise: 0
      }
    ]);
  });

  it('enforces report access, protects the catalog, and validates query parameters', async () => {
    for (const role of ['admin', 'accountant', 'owner']) {
      expect((await apiGet(
        app,
        benchmark.tokens[role],
        '/api/reports/sales-register'
      )).status).toBe(200);
    }
    for (const role of ['salesmanA', 'production']) {
      expect((await apiGet(
        app,
        benchmark.tokens[role],
        '/api/reports/sales-register'
      )).status).toBe(403);
    }
    expect((await request(app).get('/api/reports/sales-register')).status).toBe(401);
  });

  it('returns role-filtered catalog, rejects anonymous requests, and validates filters', async () => {
    const accountantCatalog = await apiGet(app, benchmark.tokens.accountant, '/api/reports');
    expect(accountantCatalog.status).toBe(200);
    expect(accountantCatalog.body.map(({ key }) => key)).toContain('sales-register');
    const salesmanCatalog = await apiGet(app, benchmark.tokens.salesmanA, '/api/reports');
    expect(salesmanCatalog.status).toBe(200);
    expect(salesmanCatalog.body).toEqual([]);
    expect((await request(app).get('/api/reports')).status).toBe(401);
    expect((await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/unknown-report'
    )).status).toBe(404);
    const today = istDate(new Date());
    const tomorrow = shiftDate(today, 1);
    const invalidPeriod = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/sales-register?from=${tomorrow}&to=${today}`
    );
    expect(invalidPeriod.status).toBe(400);
    expect(invalidPeriod.body.error.code).toBe('INVALID_PERIOD');
  });
});

describe('sales register filters and multi-invoice totals', () => {
  let context;
  let invoiceB;

  beforeAll(async () => {
    await resetDb();
    await seedBenchmarkMasters();
    context = await runBenchmarkFull(app);
    invoiceB = await createDistributorInvoice(app, context);
  }, 120000);

  it('filters distributor IGST and customer, and keeps totals independent of pagination', async () => {
    const inter = await apiGet(
      app,
      context.tokens.accountant,
      '/api/reports/sales-register?taxType=INTER'
    );
    expect(inter.status).toBe(200);
    expect(getSection(inter, 'invoices').rows).toHaveLength(1);
    expect(getSection(inter, 'invoices').rows[0]).toMatchObject({
      invoiceNo: `INV/${context.FY}/0002`,
      customerName: 'Distributor B',
      placeOfSupply: '29-Karnataka',
      taxType: 'IGST',
      taxableValuePaise: 440000,
      igstPaise: 22000,
      totalPaise: 462000
    });
    const customer = await apiGet(
      app,
      context.tokens.accountant,
      `/api/reports/sales-register?customerId=${context.ids.distributorB}`
    );
    expect(getSection(customer, 'invoices').rows.map(({ invoiceNo }) => invoiceNo))
      .toEqual([`INV/${context.FY}/0002`]);

    const pageOne = await apiGet(
      app,
      context.tokens.accountant,
      '/api/reports/sales-register?page=1&limit=1'
    );
    const pageTwo = await apiGet(
      app,
      context.tokens.accountant,
      '/api/reports/sales-register?page=2&limit=1'
    );
    expect(getSection(pageOne, 'invoices').page).toMatchObject({
      page: 1, limit: 1, total: 2, pages: 2
    });
    expect(getSection(pageTwo, 'invoices').rows[0].invoiceNo)
      .toBe(`INV/${context.FY}/0002`);
    expect(getSection(pageTwo, 'invoices').page.total).toBe(2);
    expect(getSection(pageOne, 'invoices').totals)
      .toEqual(getSection(pageTwo, 'invoices').totals);
    expect(getSection(pageTwo, 'summary').rows[0].totalPaise).toBe(1249500);
    expect(invoiceB).toBeGreaterThan(0);
  });

  it('validates period order, date formats, page bounds, unknown filters, and unknown reports', async () => {
    const today = istDate(new Date());
    const tomorrow = shiftDate(today, 1);
    const longFrom = shiftDate(today, -732);
    const invalid = [
      `/api/reports/sales-register?from=${tomorrow}&to=${today}`,
      '/api/reports/sales-register?from=not-a-date',
      '/api/reports/sales-register?unexpected=1',
      '/api/reports/sales-register?limit=500',
      `/api/reports/sales-register?from=${longFrom}&to=${today}`
    ];
    const responses = await Promise.all(invalid.map((path) =>
      apiGet(app, context.tokens.accountant, path)
    ));
    expect(responses.map(({ status }) => status)).toEqual([400, 400, 400, 400, 422]);
    expect(responses[0].body.error.code).toBe('INVALID_PERIOD');
    expect((await apiGet(app, context.tokens.accountant, '/api/reports/unknown-report')).status)
      .toBe(404);
  });
});

describe('sales register cancellation and IST day boundaries', () => {
  let context;

  beforeAll(async () => {
    await resetDb();
    await seedBenchmarkMasters();
    context = await runBenchmarkFull(app);
    const invoiceId = await createDistributorInvoice(app, context);
    await cancelInvoiceViaApi(app, context, invoiceId);
  }, 120000);

  it('shows cancelled credit-note invoice values separately from net posted sales', async () => {
    const response = await apiGet(app, context.tokens.accountant, '/api/reports/sales-register');
    const rows = getSection(response, 'invoices').rows;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      invoiceNo: `INV/${context.FY}/0002`,
      status: 'CANCELLED',
      creditNoteNo: `CN/${context.FY}/0001`
    });
    expect(getSection(response, 'summary').rows).toEqual([
      {
        label: 'Net sales (posted invoices)',
        invoices: 1,
        taxableValuePaise: 750000,
        cgstPaise: 18750,
        sgstPaise: 18750,
        igstPaise: 0,
        totalPaise: 787500
      },
      {
        label: 'Cancelled by credit note (not counted)',
        invoices: 1,
        taxableValuePaise: 440000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 22000,
        totalPaise: 462000
      }
    ]);
    const cancelled = await apiGet(
      app,
      context.tokens.accountant,
      '/api/reports/sales-register?status=CANCELLED'
    );
    expect(getSection(cancelled, 'invoices').rows.map(({ status }) => status))
      .toEqual(['CANCELLED']);
    expect(getSection(cancelled, 'summary').rows[0].invoices).toBe(0);
  });

  it('includes 23:30 IST and excludes 00:30 IST outside the inclusive period', async () => {
    const day = istDate(new Date());
    const nextDay = shiftDate(day, 1);
    const admin = await db.user.findUnique({
      where: { email: 'admin@demo.com' },
      select: { id: true }
    });
    const retailer = await db.customer.findUnique({
      where: { id: context.ids.retailerA },
      select: { id: true }
    });
    const baseInvoice = {
      financialYear: context.FY,
      customerId: retailer.id,
      placeOfSupplyStateCode: '33',
      isInterState: false,
      taxableValuePaise: 0,
      totalPaise: 0,
      createdById: admin.id
    };
    const lateInvoiceNo = `TEST-LATE/${context.FY}`;
    const earlyNextInvoiceNo = `TEST-EARLY/${context.FY}`;
    await prisma.invoice.create({
      data: {
        ...baseInvoice,
        invoiceNo: lateInvoiceNo,
        issueDate: new Date(`${day}T23:30:00+05:30`)
      }
    });
    await prisma.invoice.create({
      data: {
        ...baseInvoice,
        invoiceNo: earlyNextInvoiceNo,
        issueDate: new Date(`${nextDay}T00:30:00+05:30`)
      }
    });
    const lateSameDay = await apiGet(
      app,
      context.tokens.accountant,
      `/api/reports/sales-register?from=${day}&to=${day}`
    );
    expect(getSection(lateSameDay, 'invoices').rows).toContainEqual(
      expect.objectContaining({ invoiceNo: lateInvoiceNo, issueDate: day })
    );
    expect(getSection(lateSameDay, 'invoices').rows.map(({ invoiceNo }) => invoiceNo))
      .not.toContain(earlyNextInvoiceNo);
    const nextCalendarDay = await apiGet(
      app,
      context.tokens.accountant,
      `/api/reports/sales-register?from=${nextDay}&to=${nextDay}`
    );
    const nextDayNumbers = getSection(nextCalendarDay, 'invoices').rows
      .map(({ invoiceNo }) => invoiceNo);
    expect(nextDayNumbers).toContain(earlyNextInvoiceNo);
    expect(nextDayNumbers).not.toContain(lateInvoiceNo);
    expect(formatIstDate(new Date(`${nextDay}T00:30:00+05:30`))).toBe(nextDay);
  });
});
