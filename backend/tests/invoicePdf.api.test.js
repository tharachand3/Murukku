import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { signInvoiceLinkToken } from '../src/lib/shareToken.js';
import { getInvoiceDocument } from '../src/services/invoiceDocumentService.js';
import { renderInvoicePdf } from '../src/services/invoicePdfService.js';
import { apiPost, loginAs, seedBenchmarkMasters } from './helpers/benchmark.js';
import { db, resetDb } from './helpers/db.js';

let adminToken;
let accountantToken;
let productionToken;
let salesmanAToken;
let salesmanBToken;
let invoice;
let cancelledInvoice;
let customers;
let items;

function pdfParser(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function createPostedInvoice({ customerId, qty, clientRef, salesmanToken }) {
  const orderResponse = await apiPost(app, salesmanToken, '/api/orders', {
    clientRef,
    customerId,
    lines: [{ itemId: items.finished.id, qty }]
  });
  expect(orderResponse.status).toBe(201);
  const order = orderResponse.body.order;
  expect((await apiPost(app, adminToken, `/api/orders/${order.id}/approve`, {})).status)
    .toBe(200);
  const response = await apiPost(app, adminToken, '/api/invoices', { orderId: order.id });
  expect(response.status).toBe(201);
  return response.body;
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  const [
    admin,
    accountant,
    production,
    salesmanA,
    salesmanB,
    finished,
    pouch,
    carton,
    retailer,
    distributor
  ] = await Promise.all([
    db.user.findUnique({ where: { email: 'admin@demo.com' } }),
    db.user.findUnique({ where: { email: 'accountant@demo.com' } }),
    db.user.findUnique({ where: { email: 'production@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.a@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.b@demo.com' } }),
    db.item.findUnique({ where: { code: 'MURUKKU200' } }),
    db.item.findUnique({ where: { code: 'POUCH200' } }),
    db.item.findUnique({ where: { code: 'CARTON' } }),
    db.customer.findFirst({ where: { name: 'Retailer A' } }),
    db.customer.findFirst({ where: { name: 'Distributor B' } })
  ]);
  items = { finished, pouch, carton };
  customers = { retailer, distributor };
  [adminToken, accountantToken, productionToken, salesmanAToken, salesmanBToken] = await Promise.all([
    loginAs(app, admin.email),
    loginAs(app, accountant.email),
    loginAs(app, production.email),
    loginAs(app, salesmanA.email),
    loginAs(app, salesmanB.email)
  ]);

  const started = await apiPost(app, productionToken, '/api/production/runs', {
    finishedItemId: items.finished.id,
    batchCount: '1'
  });
  expect(started.status).toBe(201);
  const completed = await apiPost(
    app,
    productionToken,
    `/api/production/runs/${started.body.id}/complete`,
    {
      actualGoodQty: 188,
      consumption: [
        { itemId: items.pouch.id, qty: '188', unit: 'pcs' },
        { itemId: items.carton.id, qty: '9', unit: 'pcs' }
      ]
    }
  );
  expect(completed.status).toBe(200);

  invoice = await createPostedInvoice({
    customerId: customers.retailer.id,
    qty: 150,
    clientRef: 'invoice-pdf-retailer-order-001',
    salesmanToken: salesmanAToken
  });
  const dispatch = await apiPost(app, adminToken, '/api/dispatches', {
    invoiceId: invoice.id
  });
  expect(dispatch.status).toBe(201);

  cancelledInvoice = await createPostedInvoice({
    customerId: customers.distributor.id,
    qty: 88,
    clientRef: 'invoice-pdf-cancelled-order-001',
    salesmanToken: salesmanBToken
  });
  expect(cancelledInvoice).toMatchObject({
    taxableValuePaise: 440000,
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 22000,
    totalPaise: 462000
  });
  const cancelled = await apiPost(
    app,
    adminToken,
    `/api/invoices/${cancelledInvoice.id}/cancel`,
    { reason: 'PDF test cancellation' }
  );
  expect(cancelled.status).toBe(200);
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('invoice PDF and sharing API', { timeout: 180000 }, () => {
  it('downloads authenticated invoice PDFs with role checks and disposition', async () => {
    const noToken = await request(app).get(`/api/invoices/${invoice.id}/pdf`);
    expect(noToken.status).toBe(401);
    const forbidden = await request(app)
      .get(`/api/invoices/${invoice.id}/pdf`)
      .set('Authorization', `Bearer ${productionToken}`);
    expect(forbidden.status).toBe(403);

    const response = await request(app)
      .get(`/api/invoices/${invoice.id}/pdf?disposition=inline`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .buffer(true)
      .parse(pdfParser);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/pdf/);
    expect(response.headers['content-disposition']).toContain('inline; filename="INV-');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(response.body.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(1);
  });

  it('creates a signed public link that downloads without authentication', async () => {
    const shareResponse = await request(app)
      .get(`/api/invoices/${invoice.id}/share`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(shareResponse.status).toBe(200);
    expect(shareResponse.body).toMatchObject({
      invoiceNo: invoice.invoiceNo,
      customer: { name: 'Retailer A' }
    });
    expect(shareResponse.body.pdfUrl).toContain('/api/public/invoices/');
    expect(shareResponse.body.whatsappUrl).toContain('https://wa.me/');
    expect(shareResponse.body.mailtoUrl).toContain('mailto:?subject=');
    expect(shareResponse.body.text).toContain('for Rs 7,875.00');
    expect(Date.parse(shareResponse.body.expiresAt)).not.toBeNaN();

    const publicPath = new URL(shareResponse.body.pdfUrl).pathname;
    const response = await request(app)
      .get(publicPath)
      .buffer(true)
      .parse(pdfParser);
    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(response.body.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(1);
  });

  it('rejects invalid public links and returns 404 when an invoice is gone', async () => {
    const invalid = await request(app).get('/api/public/invoices/not-a-token/pdf');
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_LINK');

    const missingToken = signInvoiceLinkToken(2147483647);
    const missing = await request(app).get(`/api/public/invoices/${missingToken}/pdf`);
    expect(missing.status).toBe(404);
  });

  it('serves cancelled invoices so the renderer can add its watermark', async () => {
    const response = await request(app)
      .get(`/api/invoices/${cancelledInvoice.id}/pdf`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse(pdfParser);
    expect(response.status).toBe(200);
    expect(response.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('repeats invoice table headers across pages for large invoices', async () => {
    const model = await getInvoiceDocument(db, invoice.id);
    model.lines = Array.from({ length: 240 }, (_, index) => ({
      ...model.lines[0],
      srNo: index + 1,
      description: `Murukku 200 g row ${index + 1}`
    }));
    const buffer = await renderInvoicePdf(model);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(3);
  });
});
