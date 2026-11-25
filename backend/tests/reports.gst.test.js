import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { currentFinancialYear, financialYearOf } from '../src/lib/fy.js';
import { formatIstDate } from '../src/lib/reportKit.js';
import { prisma } from '../src/lib/prisma.js';
import { apiGet, apiPost, seedBenchmarkMasters } from './helpers/benchmark.js';
import {
  cancelInvoiceViaApi
} from './helpers/benchmarkExtras.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { db, resetDb } from './helpers/db.js';

function getSection(response, key) {
  return response.body.sections.find((section) => section.key === key);
}

function outwardNetRow(response) {
  return getSection(response, 'gstr3b-outward').rows.find(
    ({ description }) => description === '3.1(a) Outward taxable supplies (net)'
  );
}

function assertIssuedConsistency(response) {
  const invoiceRow = getSection(response, 'gstr3b-outward').rows[0];
  const invoiceRows = [
    ...getSection(response, 'gstr1-b2b').rows,
    ...getSection(response, 'gstr1-b2cl').rows,
    ...getSection(response, 'gstr1-b2cs').rows
  ];
  for (const field of [
    'taxableValuePaise',
    'igstPaise',
    'cgstPaise',
    'sgstPaise'
  ]) {
    expect(invoiceRow[field]).toBe(
      invoiceRows.reduce((total, row) => total + row[field], 0)
    );
  }
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

async function createBackdatedInvoice(context) {
  const [customer, admin, item] = await Promise.all([
    db.customer.findUnique({
      where: { id: context.ids.distributorB },
      select: { id: true }
    }),
    db.user.findUnique({
      where: { email: 'admin@demo.com' },
      select: { id: true }
    }),
    db.item.findUnique({
      where: { id: context.ids.murukku },
      select: { id: true }
    })
  ]);
  const issueDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  const invoiceFinancialYear = financialYearOf(issueDate);
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNo: `INV/${invoiceFinancialYear}/9001`,
      financialYear: invoiceFinancialYear,
      customerId: customer.id,
      issueDate,
      placeOfSupplyStateCode: '29',
      isInterState: true,
      taxableValuePaise: 50000,
      igstPaise: 2500,
      totalPaise: 52500,
      createdById: admin.id,
      lines: {
        create: {
          itemId: item.id,
          description: 'Murukku 200 g',
          hsnCode: '21069099',
          qty: 10,
          ratePaise: 5000,
          taxableValuePaise: 50000,
          gstRateBp: 500,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 2500,
          totalPaise: 52500
        }
      }
    }
  });
  return invoice;
}

let benchmark;
let distributorInvoiceId;
let distributorGstin;
const fy = currentFinancialYear();

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  benchmark = await runBenchmarkFull(app);
  const distributor = await db.customer.findUnique({
    where: { id: benchmark.ids.distributorB },
    select: { gstin: true }
  });
  distributorGstin = distributor.gstin;
}, 120000);

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('GST summary report', () => {
  it('reports the benchmark B2B invoice and GSTR-3B values', async () => {
    const report = await apiGet(app, benchmark.tokens.accountant, '/api/reports/gst-summary');
    expect(report.status).toBe(200);
    expect(getSection(report, 'gstr1-b2b').rows).toEqual([{
      gstin: '33AAAAA0000A1Z5',
      receiverName: 'Retailer A',
      invoiceNo: `INV/${fy}/0001`,
      invoiceDate: formatIstDate(new Date()),
      invoiceValuePaise: 787500,
      placeOfSupply: '33-Tamil Nadu',
      reverseCharge: 'N',
      invoiceType: 'Regular',
      ratePct: '5',
      taxableValuePaise: 750000,
      igstPaise: 0,
      cgstPaise: 18750,
      sgstPaise: 18750,
      cessPaise: 0
    }]);
    expect(getSection(report, 'gstr1-b2cl').rows).toEqual([]);
    expect(getSection(report, 'gstr1-b2cs').rows).toEqual([]);
    expect(getSection(report, 'gstr1-cdnr').rows).toEqual([]);
    expect(getSection(report, 'gstr1-cdnur').rows).toEqual([]);
    expect(outwardNetRow(report)).toMatchObject({
      taxableValuePaise: 750000,
      igstPaise: 0,
      cgstPaise: 18750,
      sgstPaise: 18750,
      cessPaise: 0
    });
    expect(getSection(report, 'gstr1-hsn').rows).toEqual([{
      hsnCode: '21069099',
      description: 'Murukku 200 g',
      uqc: 'PAC',
      qty: 150,
      ratePct: '5',
      totalValuePaise: 787500,
      taxableValuePaise: 750000,
      igstPaise: 0,
      cgstPaise: 18750,
      sgstPaise: 18750
    }]);
    expect(getSection(report, 'gstr1-docs').rows).toEqual([
      {
        description: 'Invoices for outward supply',
        fromSerial: `INV/${fy}/0001`,
        toSerial: `INV/${fy}/0001`,
        totalNumber: 1,
        cancelled: 0
      },
      {
        description: 'Credit notes',
        fromSerial: null,
        toSerial: null,
        totalNumber: 0,
        cancelled: 0
      }
    ]);
    assertIssuedConsistency(report);

    for (const role of ['admin', 'accountant', 'owner']) {
      expect((await apiGet(
        app,
        benchmark.tokens[role],
        '/api/reports/gst-summary'
      )).status).toBe(200);
    }
    for (const role of ['salesmanA', 'production']) {
      expect((await apiGet(
        app,
        benchmark.tokens[role],
        '/api/reports/gst-summary'
      )).status).toBe(403);
    }
    expect((await request(app).get('/api/reports/gst-summary')).status).toBe(401);
    expect((await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/gst-summary?unexpected=true'
    )).status).toBe(400);
    const catalog = await apiGet(app, benchmark.tokens.accountant, '/api/reports');
    expect(catalog.body.map(({ key }) => key)).toContain('gst-summary');
  });

  it('includes all invoice statuses, classifies unregistered supplies, and reconciles invoices', async () => {
    distributorInvoiceId = await createDistributorInvoice(benchmark);
    let report = await apiGet(app, benchmark.tokens.accountant, '/api/reports/gst-summary');
    expect(getSection(report, 'gstr1-b2b').rows).toHaveLength(2);
    expect(getSection(report, 'gstr1-b2b').rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        receiverName: 'Distributor B',
        placeOfSupply: '29-Karnataka',
        ratePct: '5',
        taxableValuePaise: 440000,
        igstPaise: 22000
      })
    ]));
    expect(outwardNetRow(report)).toMatchObject({
      taxableValuePaise: 1190000,
      igstPaise: 22000,
      cgstPaise: 18750,
      sgstPaise: 18750
    });
    expect(getSection(report, 'gstr1-hsn').rows[0]).toMatchObject({
      qty: 238,
      totalValuePaise: 1249500,
      taxableValuePaise: 1190000
    });
    expect(getSection(report, 'gstr1-docs').rows[0].totalNumber).toBe(2);
    assertIssuedConsistency(report);

    await prisma.customer.update({
      where: { id: benchmark.ids.distributorB },
      data: { gstin: null }
    });
    report = await apiGet(app, benchmark.tokens.accountant, '/api/reports/gst-summary');
    expect(getSection(report, 'gstr1-b2b').rows).toHaveLength(1);
    expect(getSection(report, 'gstr1-b2cs').rows).toEqual([{
      supplyType: 'Inter-State',
      placeOfSupply: '29-Karnataka',
      ratePct: '5',
      taxableValuePaise: 440000,
      igstPaise: 22000,
      cgstPaise: 0,
      sgstPaise: 0,
      cessPaise: 0
    }]);
    expect(getSection(report, 'gstr3b-interstate-unregistered').rows).toEqual([{
      placeOfSupply: '29-Karnataka',
      taxableValuePaise: 440000,
      igstPaise: 22000
    }]);
    assertIssuedConsistency(report);

    await prisma.customer.update({
      where: { id: benchmark.ids.distributorB },
      data: { gstin: distributorGstin }
    });
    await cancelInvoiceViaApi(app, benchmark, distributorInvoiceId);
    report = await apiGet(app, benchmark.tokens.accountant, '/api/reports/gst-summary');
    expect(getSection(report, 'gstr1-b2b').rows).toHaveLength(2);
    expect(getSection(report, 'gstr1-cdnr').rows).toEqual([
      expect.objectContaining({
        noteNo: `CN/${fy}/0001`,
        originalInvoiceNo: `INV/${fy}/0002`,
        noteValuePaise: 462000,
        placeOfSupply: '29-Karnataka',
        ratePct: '5',
        taxableValuePaise: 440000,
        igstPaise: 22000
      })
    ]);
    expect(getSection(report, 'gstr3b-outward').rows[1]).toMatchObject({
      taxableValuePaise: -440000,
      igstPaise: -22000
    });
    expect(outwardNetRow(report)).toMatchObject({
      taxableValuePaise: 750000,
      igstPaise: 0,
      cgstPaise: 18750,
      sgstPaise: 18750
    });
    expect(getSection(report, 'gstr1-hsn').rows).toMatchObject([
      expect.objectContaining({ qty: 150, totalValuePaise: 787500 })
    ]);
    expect(getSection(report, 'gstr1-docs').rows[1].totalNumber).toBe(1);
    assertIssuedConsistency(report);
  });

  it('nets a current credit note against a prior-period invoice only in the note period', async () => {
    await resetDb();
    await seedBenchmarkMasters();
    benchmark = await runBenchmarkFull(app);
    const invoice = await createBackdatedInvoice(benchmark);
    await prisma.customer.update({
      where: { id: benchmark.ids.distributorB },
      data: { gstin: distributorGstin }
    });
    const earlierDate = formatIstDate(invoice.issueDate);
    await cancelInvoiceViaApi(app, benchmark, invoice.id);

    const today = formatIstDate(new Date());
    const notePeriod = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/gst-summary?from=${today}&to=${today}`
    );
    expect(getSection(notePeriod, 'gstr3b-outward').rows[0]).toMatchObject({
      taxableValuePaise: 750000,
      cgstPaise: 18750,
      sgstPaise: 18750
    });
    expect(getSection(notePeriod, 'gstr3b-outward').rows[1]).toMatchObject({
      taxableValuePaise: -50000,
      igstPaise: -2500
    });
    expect(outwardNetRow(notePeriod)).toMatchObject({
      taxableValuePaise: 700000,
      igstPaise: -2500,
      cgstPaise: 18750,
      sgstPaise: 18750
    });
    expect(getSection(notePeriod, 'gstr1-hsn').rows).toMatchObject([
      expect.objectContaining({
        qty: 140,
        totalValuePaise: 735000,
        taxableValuePaise: 700000
      })
    ]);
    expect(getSection(notePeriod, 'gstr1-cdnr').rows).toEqual([
      expect.objectContaining({
        noteValuePaise: 52500,
        taxableValuePaise: 50000,
        igstPaise: 2500
      })
    ]);
    assertIssuedConsistency(notePeriod);

    const invoicePeriod = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/gst-summary?from=${earlierDate}&to=${earlierDate}`
    );
    expect(getSection(invoicePeriod, 'gstr1-b2b').rows).toEqual([
      expect.objectContaining({
        invoiceNo: invoice.invoiceNo,
        taxableValuePaise: 50000,
        igstPaise: 2500
      })
    ]);
    expect(getSection(invoicePeriod, 'gstr1-cdnr').rows).toEqual([]);
    expect(outwardNetRow(invoicePeriod)).toMatchObject({
      taxableValuePaise: 50000,
      igstPaise: 2500
    });
    assertIssuedConsistency(invoicePeriod);
  });
});
