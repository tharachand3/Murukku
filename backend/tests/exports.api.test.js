import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import {
  apiGet,
  apiPost,
  seedBenchmarkMasters
} from './helpers/benchmark.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { db, resetDb } from './helpers/db.js';

function parseBuffer(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

function exportRequest(path, token) {
  return request(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .buffer()
    .parse(parseBuffer);
}

let benchmark;

describe('report export API', () => {
  beforeAll(async () => {
    await resetDb();
    await seedBenchmarkMasters();
    benchmark = await runBenchmarkFull(app);
  }, 180000);

  afterAll(async () => {
    await Promise.all([db.$disconnect(), prisma.$disconnect()]);
  });

  it('exports the benchmark sales register as formatted CSV', async () => {
    const response = await exportRequest(
      '/api/reports/sales-register/export?format=csv&page=99&limit=1',
      benchmark.tokens.accountant
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="sales-register_[a-z0-9_.-]+\.csv"/
    );
    expect(response.headers['cache-control']).toBe('no-store');
    const csv = response.body.toString('utf8');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3);
    expect(csv).toContain('Invoice no.');
    expect(csv).toContain(`INV/${benchmark.FY}/0001`);
    expect(csv).toContain('7875.00');
    expect(csv).toContain('187.50');
    expect(csv).toContain('Total');
  });

  it('supports first-section and selected-section GST CSV exports', async () => {
    const defaultCsv = await exportRequest(
      '/api/reports/gst-summary/export?format=csv',
      benchmark.tokens.accountant
    );
    const b2bCsv = await exportRequest(
      '/api/reports/gst-summary/export?format=csv&section=gstr1-b2b',
      benchmark.tokens.accountant
    );
    const invalid = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/gst-summary/export?format=csv&section=nope'
    );
    expect(defaultCsv.status).toBe(200);
    expect(b2bCsv.status).toBe(200);
    expect(defaultCsv.body.toString('utf8')).toContain('Description');
    expect(b2bCsv.body.toString('utf8')).toContain('GSTIN');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('UNKNOWN_SECTION');
  });

  it('returns a formatted XLSX workbook for the sales register', async () => {
    const response = await exportRequest(
      '/api/reports/sales-register/export?format=xlsx',
      benchmark.tokens.accountant
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const invoices = workbook.worksheets.find(({ name }) => name === 'Invoices');
    expect(workbook.worksheets.map(({ name }) => name)).toContain('Report info');
    expect(invoices.getCell('L2').value).toBe(7875);
    expect(invoices.getCell('L2').numFmt).toBe('#,##0.00');
    expect(invoices.getRow(1).font.bold).toBe(true);
    expect(invoices.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('renders a PDF report and paginates large export requests', async () => {
    const response = await exportRequest(
      '/api/reports/sales-register/export?format=pdf',
      benchmark.tokens.accountant
    );
    expect(response.status).toBe(200);
    const pdf = response.body.toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect((pdf.match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('exports the product-costing benchmark with exact cost and margin values', async () => {
    const report = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/product-costing'
    );
    expect(report.status).toBe(200);
    const murukku = report.body.sections[0].rows.find(({ productCode }) => (
      productCode === 'MURUKKU200'
    ));
    expect(murukku).toMatchObject({
      runs: 1,
      goodQty: 188,
      totalCostPaise: 585500,
      avgCostPerPacketPaise: '3114.3617',
      marginPctBp: 3771
    });
    expect(report.body.sections[1].rows[0]).toMatchObject({
      productName: 'Murukku 200 g',
      goodQty: 188,
      totalCostPaise: 585500,
      costPerPacketPaise: '3114.3617',
      marginPctBp: 3771
    });
    const csv = await exportRequest(
      '/api/reports/product-costing/export?format=csv',
      benchmark.tokens.accountant
    );
    expect(csv.status).toBe(200);
    expect(csv.body.toString('utf8')).toContain('31.14');
    expect(csv.body.toString('utf8')).toContain('37.71');
  });

  it('enforces access, option, and filter validation for exports', async () => {
    expect((await request(app).get('/api/reports/sales-register/export')).status).toBe(401);
    expect((await apiGet(
      app,
      benchmark.tokens.salesmanA,
      '/api/reports/sales-register/export'
    )).status).toBe(403);
    expect((await apiGet(
      app,
      benchmark.tokens.production,
      '/api/reports/sales-register/export'
    )).status).toBe(403);
    expect((await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/sales-register/export?format=docx'
    )).status).toBe(400);
    const unknownFilter = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/sales-register/export?unexpected=yes'
    );
    expect(unknownFilter.status).toBe(400);
    expect(unknownFilter.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('exports formula-like customer names with text protection', async () => {
    const salesman = await db.user.findUnique({
      where: { email: 'salesman.a@demo.com' },
      select: { id: true }
    });
    const customer = await apiPost(app, benchmark.tokens.admin, '/api/customers', {
      name: '=SUM(1)',
      type: 'RETAILER',
      stateCode: '33',
      assignedSalesmanId: salesman.id
    });
    expect(customer.status).toBe(201);
    const order = await apiPost(app, benchmark.tokens.salesmanA, '/api/orders', {
      clientRef: 'export-formula-customer-0001',
      customerId: customer.body.id,
      lines: [{ itemId: benchmark.ids.murukku, qty: 1 }]
    });
    expect(order.status).toBe(201);
    const approval = await apiPost(
      app,
      benchmark.tokens.admin,
      `/api/orders/${order.body.order.id}/approve`,
      {}
    );
    expect(approval.status).toBe(200);
    const invoice = await apiPost(app, benchmark.tokens.admin, '/api/invoices', {
      orderId: order.body.order.id
    });
    expect(invoice.status).toBe(201);
    const csv = await exportRequest(
      '/api/reports/sales-register/export?format=csv',
      benchmark.tokens.accountant
    );
    expect(csv.status).toBe(200);
    expect(csv.body.toString('utf8')).toContain("'=SUM(1)");
  });

  it('exports every catalog report in all formats under its required role', async () => {
    const catalog = await apiGet(app, benchmark.tokens.admin, '/api/reports');
    expect(catalog.status).toBe(200);
    expect(catalog.body.length).toBeGreaterThanOrEqual(9);
    const tokenForCapability = {
      'production:read': benchmark.tokens.production,
      'stock:read': benchmark.tokens.production,
      'purchases:read': benchmark.tokens.production,
      'costing:read': benchmark.tokens.accountant,
      'payments:read': benchmark.tokens.accountant,
      'reports:read': benchmark.tokens.accountant
    };
    for (const report of catalog.body) {
      expect(report.exportFormats).toEqual(['csv', 'xlsx', 'pdf']);
      expect(report.sections.length).toBeGreaterThan(0);
      const token = tokenForCapability[report.capability];
      expect(token).toBeTruthy();
      for (const format of report.exportFormats) {
        const response = await exportRequest(
          `/api/reports/${report.key}/export?format=${format}`,
          token
        );
        expect(response.status, `${report.key} ${format}`).toBe(200);
        expect(response.body.length, `${report.key} ${format} body`).toBeGreaterThan(0);
        const forbidden = await apiGet(
          app,
          benchmark.tokens.salesmanA,
          `/api/reports/${report.key}/export?format=${format}`
        );
        expect(forbidden.status, `salesman ${report.key} ${format}`).toBe(403);
      }
    }
  });
}, 180000);
