import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { formatIstDate } from '../src/lib/reportKit.js';
import { prisma } from '../src/lib/prisma.js';
import { getCustomerOutstanding } from '../src/services/paymentService.js';
import { apiGet, apiPost, seedBenchmarkMasters } from './helpers/benchmark.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { db, resetDb } from './helpers/db.js';

let benchmark;
let adminId;

function section(response, key) {
  return response.body.sections.find((candidate) => candidate.key === key);
}

function shiftIstDate(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+05:30`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIstDate(date);
}

function atIstTime(dateText, time) {
  return new Date(`${dateText}T${time}+05:30`);
}

async function createInvoice({
  invoiceNo,
  issueDate,
  totalPaise,
  status = 'POSTED',
  cancelledAt = null,
  customerId = benchmark.ids.retailerA
}) {
  return db.invoice.create({
    data: {
      invoiceNo,
      financialYear: benchmark.FY,
      customerId,
      issueDate,
      placeOfSupplyStateCode: '33',
      isInterState: false,
      taxableValuePaise: totalPaise,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      totalPaise,
      status,
      cancelledAt,
      createdById: adminId
    }
  });
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  benchmark = await runBenchmarkFull(app);
  adminId = (await db.user.findUnique({ where: { email: 'admin@demo.com' } })).id;
}, 120000);

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('receivables ageing report', () => {
  it('places the benchmark balance in the current 0-30 day bucket', async () => {
    const response = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/receivables-ageing'
    );
    expect(response.status).toBe(200);
    expect(response.body.report).toMatchObject({
      key: 'receivables-ageing',
      title: 'Receivables Ageing',
      group: 'receivables'
    });
    expect(response.body.period.asOf).toBe(formatIstDate(new Date()));
    expect(section(response, 'customers').rows).toEqual([{
      customerId: benchmark.ids.retailerA,
      customerName: 'Retailer A',
      customerType: 'RETAILER',
      bucket0To30Paise: 387500,
      bucket31To60Paise: 0,
      bucket61To90Paise: 0,
      bucket91PlusPaise: 0,
      outstandingPaise: 387500,
      creditPaise: 0
    }]);
    expect(section(response, 'customers').totals).toMatchObject({
      bucket0To30Paise: 387500,
      outstandingPaise: 387500
    });
    expect(section(response, 'customers').rows[0].outstandingPaise).toBe(
      (await getCustomerOutstanding(db, benchmark.ids.retailerA)).outstandingPaise
    );
  });

  it('applies unallocated payments to the oldest eligible invoice first', async () => {
    const today = formatIstDate(new Date());
    const olderDate = shiftIstDate(today, -45);
    const olderInvoice = await createInvoice({
      invoiceNo: `INV/${benchmark.FY}/AGE-OLD-0001`,
      issueDate: atIstTime(olderDate, '12:00'),
      totalPaise: 100000
    });
    const payment = await apiPost(app, benchmark.tokens.admin, '/api/payments', {
      customerId: benchmark.ids.retailerA,
      amountPaise: 125000,
      mode: 'UPI',
      reference: 'AGEFIFO123'
    });
    expect(payment.status).toBe(201);

    const response = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/receivables-ageing?detail=true&customerId=${benchmark.ids.retailerA}`
    );
    expect(response.status).toBe(200);
    expect(section(response, 'customers').rows[0]).toMatchObject({
      bucket0To30Paise: 362500,
      bucket31To60Paise: 0,
      outstandingPaise: 362500
    });
    expect(section(response, 'customers').rows[0].outstandingPaise).toBe(
      (await getCustomerOutstanding(db, benchmark.ids.retailerA)).outstandingPaise
    );
    expect(section(response, 'invoices').rows).toEqual([
      expect.objectContaining({
        invoiceNo: olderInvoice.invoiceNo,
        bucket: '31-60',
        totalPaise: 100000,
        paidPaise: 100000,
        duePaise: 0
      }),
      expect.objectContaining({
        invoiceNo: `INV/${benchmark.FY}/0001`,
        bucket: '0-30',
        paidPaise: 425000,
        duePaise: 362500
      })
    ]);
  });

  it('uses the IST as-of cutoff for invoice dates, cancellations, and payments', async () => {
    const today = formatIstDate(new Date());
    const asOf = shiftIstDate(today, -3);
    const nextDay = shiftIstDate(asOf, 1);
    const asOfCustomer = await db.customer.create({
      data: {
        name: 'Ageing Cutoff Customer',
        type: 'RETAILER',
        stateCode: '33',
        stateName: 'Tamil Nadu'
      }
    });
    const cancelledAfterCutoff = await createInvoice({
      invoiceNo: `INV/${benchmark.FY}/AGE-CANCELLED-0001`,
      issueDate: atIstTime(asOf, '23:30'),
      totalPaise: 10000,
      status: 'CANCELLED',
      cancelledAt: atIstTime(nextDay, '00:30'),
      customerId: asOfCustomer.id
    });
    const nextDayInvoice = await createInvoice({
      invoiceNo: `INV/${benchmark.FY}/AGE-NEXTDAY-0001`,
      issueDate: atIstTime(nextDay, '00:30'),
      totalPaise: 20000,
      customerId: asOfCustomer.id
    });
    await db.payment.create({
      data: {
        receiptNo: `RCT/${benchmark.FY}/AGE-FUTURE-0001`,
        customerId: asOfCustomer.id,
        invoiceId: cancelledAfterCutoff.id,
        amountPaise: 4000,
        mode: 'UPI',
        reference: 'AGECUTOFF123',
        paymentDate: atIstTime(nextDay, '00:30'),
        createdById: adminId
      }
    });

    const response = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/receivables-ageing?asOf=${asOf}&customerId=${asOfCustomer.id}&detail=true`
    );
    expect(response.status).toBe(200);
    expect(section(response, 'customers').rows).toHaveLength(1);
    expect(section(response, 'customers').rows[0]).toMatchObject({
      bucket0To30Paise: 10000,
      outstandingPaise: 10000
    });
    expect(section(response, 'invoices').rows).toEqual([{
      invoiceNo: cancelledAfterCutoff.invoiceNo,
      customerName: 'Ageing Cutoff Customer',
      issueDate: asOf,
      ageDays: 0,
      bucket: '0-30',
      totalPaise: 10000,
      paidPaise: 0,
      duePaise: 10000
    }]);

    const afterCancellation = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/receivables-ageing?asOf=${nextDay}&customerId=${asOfCustomer.id}&detail=true`
    );
    expect(section(afterCancellation, 'invoices').rows).toEqual([{
      invoiceNo: nextDayInvoice.invoiceNo,
      customerName: 'Ageing Cutoff Customer',
      issueDate: nextDay,
      ageDays: 0,
      bucket: '0-30',
      totalPaise: 20000,
      paidPaise: 4000,
      duePaise: 16000
    }]);
  });

  it('enforces access and rejects unknown or malformed filters', async () => {
    for (const role of ['admin', 'accountant', 'owner']) {
      expect((await apiGet(
        app,
        benchmark.tokens[role],
        '/api/reports/receivables-ageing'
      )).status).toBe(200);
    }
    for (const role of ['salesmanA', 'production']) {
      expect((await apiGet(
        app,
        benchmark.tokens[role],
        '/api/reports/receivables-ageing'
      )).status).toBe(403);
    }
    expect((await request(app).get('/api/reports/receivables-ageing')).status).toBe(401);
    expect((await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/receivables-ageing?unknown=true'
    )).status).toBe(400);
    expect((await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/receivables-ageing?asOf=2026-02-30'
    )).status).toBe(400);
  });
});
