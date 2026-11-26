import { inflateSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    config: Object.freeze({
      ...original.config,
      PUBLIC_BASE_URL: 'https://public.example.test'
    })
  };
});

import request from 'supertest';
import { app } from '../src/app.js';
import { config } from '../src/config/env.js';
import { currentFinancialYear } from '../src/lib/fy.js';
import { signInvoiceLinkToken } from '../src/lib/shareToken.js';
import { getInvoiceDocument } from '../src/services/invoiceDocumentService.js';
import { renderInvoicePdf } from '../src/services/invoicePdfService.js';
import { createDistributorInvoice, cancelInvoiceViaApi } from './helpers/benchmarkExtras.js';
import { apiGet, seedBenchmarkMasters } from './helpers/benchmark.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { db, resetDb } from './helpers/db.js';
import { prisma } from '../src/lib/prisma.js';

let benchmark;
let distributorInvoice;

function parseBuffer(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

function requestPdf(route, token) {
  let call = request(app).get(route).buffer(true).parse(parseBuffer);
  if (token) {
    call = call.set('Authorization', `Bearer ${token}`);
  }
  return call;
}

function pdfContainsText(buffer, text) {
  if (buffer.includes(Buffer.from(text))) {
    return true;
  }
  const serialized = buffer.toString('latin1');
  let offset = 0;
  while (true) {
    const marker = serialized.indexOf('stream', offset);
    if (marker < 0) {
      return false;
    }
    const start = serialized.startsWith('\r\n', marker + 6)
      ? marker + 8
      : marker + 6 + (serialized[marker + 6] === '\n' ? 1 : 0);
    const end = serialized.indexOf('endstream', start);
    if (end < 0) {
      return false;
    }
    const stream = buffer.subarray(start, end).subarray(0, end - start);
    for (let trim = 0; trim <= 2; trim += 1) {
      try {
        const content = inflateSync(stream.subarray(0, stream.length - trim));
        const contentText = content.toString('latin1').toUpperCase();
        const encodedText = Buffer.from(text).toString('hex').toUpperCase();
        if (contentText.includes(text.toUpperCase()) || contentText.includes(`<${encodedText}>`)) {
          return true;
        }
      } catch {
        // Non-Flate streams and trailing line endings are expected in PDFs.
      }
    }
    offset = end + 9;
  }
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  benchmark = await runBenchmarkFull(app);
  const result = await createDistributorInvoice(app, benchmark);
  distributorInvoice = await db.invoice.findUnique({ where: { id: result.invoiceId } });
}, 180000);

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('step 45 invoice PDF audit', { timeout: 180000 }, () => {
  it('refuses to create a demo PDF when no invoice exists and prints the recovery command', async () => {
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/auth/login') {
        res.end(JSON.stringify({ token: 'audit-demo-token' }));
        return;
      }
      if (req.url === '/api/invoices?limit=1&page=1') {
        res.end(JSON.stringify({ items: [] }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'unexpected request' }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const script = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../scripts/invoice-pdf-demo.js'
    );
    try {
      const child = spawn(process.execPath, [script], {
        cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
        env: {
          ...process.env,
          API_URL: `http://127.0.0.1:${address.port}`
        },
        windowsHide: true
      });
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      expect(exitCode).toBe(1);
      expect(output).toContain('No posted invoice exists');
      expect(output).toContain('npm run bench:play');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (
        error ? reject(error) : resolve()
      )));
    }
  });

  it('returns benchmark documents and honors all invoice PDF access roles', async () => {
    const roles = [
      ['admin', benchmark.tokens.admin, 200],
      ['accountant', benchmark.tokens.accountant, 200],
      ['owner', benchmark.tokens.owner, 200],
      ['salesman', benchmark.tokens.salesmanA, 403],
      ['production', benchmark.tokens.production, 403]
    ];
    for (const [role, token, status] of roles) {
      const response = await requestPdf(`/api/invoices/${benchmark.ids.invoiceA}/pdf`, token);
      expect(response.status, role).toBe(status);
      if (status === 200) {
        expect(response.body.subarray(0, 5).toString()).toBe('%PDF-');
        expect(response.body.length).toBeGreaterThan(1500);
        expect(response.body.toString('latin1').trimEnd()).toMatch(/%%EOF$/);
        expect(response.headers['content-disposition']).toBe(
          `attachment; filename="INV-${currentFinancialYear()}-0001.pdf"`
        );
      }
    }

    const noToken = await requestPdf(`/api/invoices/${benchmark.ids.invoiceA}/pdf`);
    const unknownId = await requestPdf('/api/invoices/2147483647/pdf', benchmark.tokens.admin);
    const invalidId = await requestPdf('/api/invoices/abc/pdf', benchmark.tokens.admin);
    expect(noToken.status).toBe(401);
    expect(unknownId.status).toBe(404);
    expect(invalidId.status).toBe(400);
  });

  it('models the real Distributor B invoice and proves stored line snapshots survive master changes', async () => {
    const model = await getInvoiceDocument(db, distributorInvoice.id);
    expect(model).toMatchObject({
      invoice: {
        invoiceNo: `INV/${currentFinancialYear()}/0002`,
        status: 'POSTED'
      },
      supply: { placeOfSupply: '29-Karnataka', taxType: 'IGST' },
      lines: [{
        hsnCode: '21069099',
        qty: 88,
        taxableValuePaise: 440000,
        igstPaise: 22000,
        totalPaise: 462000
      }],
      totals: {
        taxableValuePaise: 440000,
        igstPaise: 22000,
        totalPaise: 462000
      },
      amountInWords: 'Rupees Four Thousand Six Hundred Twenty Only'
    });

    const originalItem = await db.item.findUnique({
      where: { id: benchmark.ids.murukku },
      select: { name: true, sellingPricePaise: true }
    });
    try {
      await db.item.update({
        where: { id: benchmark.ids.murukku },
        data: { name: 'Renamed Murukku', sellingPricePaise: 1234 }
      });
      const afterChange = await getInvoiceDocument(db, distributorInvoice.id);
      expect(afterChange.lines[0]).toMatchObject({
        description: model.lines[0].description,
        hsnCode: model.lines[0].hsnCode,
        ratePaise: model.lines[0].ratePaise,
        taxableValuePaise: model.lines[0].taxableValuePaise,
        totalPaise: model.lines[0].totalPaise
      });
    } finally {
      await db.item.update({
        where: { id: benchmark.ids.murukku },
        data: originalItem
      });
    }
  });

  it('surfaces invoice total corruption as HTTP 500 and preserves an empty address and long description', async () => {
    const originalFindUnique = prisma.invoice.findUnique.bind(prisma.invoice);
    const spy = vi.spyOn(prisma.invoice, 'findUnique').mockImplementation(async (args) => {
      const invoice = await db.invoice.findUnique(args);
      return { ...invoice, totalPaise: invoice.totalPaise + 1 };
    });
    try {
      const response = await request(app)
        .get(`/api/invoices/${benchmark.ids.invoiceA}/pdf`)
        .set('Authorization', `Bearer ${benchmark.tokens.admin}`);
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INVOICE_TOTAL_MISMATCH');
    } finally {
      spy.mockRestore();
      prisma.invoice.findUnique = originalFindUnique;
    }

    const model = await getInvoiceDocument(db, benchmark.ids.invoiceA);
    model.company.address = '';
    model.customer.address = '';
    model.lines[0].description = 'D'.repeat(200);
    const buffer = await renderInvoicePdf(model);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1500);
  });

  it('renders a 60-line invoice on multiple pages', async () => {
    const model = await getInvoiceDocument(db, benchmark.ids.invoiceA);
    model.lines = Array.from({ length: 60 }, (_, index) => ({
      ...model.lines[0],
      srNo: index + 1,
      description: `Murukku item ${index + 1}`
    }));
    const buffer = await renderInvoicePdf(model);
    const pageCount = (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(2);
  });

  it('includes cancellation credit-note details and renders the CANCELLED watermark', async () => {
    const cancelled = await cancelInvoiceViaApi(
      app,
      benchmark,
      distributorInvoice.id,
      'Cancel Distributor B audit invoice'
    );
    const model = await getInvoiceDocument(db, distributorInvoice.id);
    expect(model.cancellation).toMatchObject({
      creditNoteNo: cancelled.creditNote.noteNo,
      reason: 'Cancel Distributor B audit invoice'
    });
    const buffer = await renderInvoicePdf(model);
    expect(pdfContainsText(buffer, 'CANCELLED')).toBe(true);
    const endpoint = await requestPdf(
      `/api/invoices/${distributorInvoice.id}/pdf`,
      benchmark.tokens.admin
    );
    expect(endpoint.status).toBe(200);
  });

  it('enforces share permissions, empty-phone links, public base URL and token rejection', async () => {
    const forbidden = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/invoices/${benchmark.ids.invoiceA}/share`
    );
    expect(forbidden.status).toBe(403);

    await db.customer.update({
      where: { id: benchmark.ids.retailerA },
      data: { phone: null }
    });
    const share = await apiGet(
      app,
      benchmark.tokens.admin,
      `/api/invoices/${benchmark.ids.invoiceA}/share`
    );
    expect(share.status).toBe(200);
    expect(share.body.pdfUrl).toMatch(
      /^https:\/\/public\.example\.test\/api\/public\/invoices\/.+\/pdf$/
    );
    expect(share.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(share.body.mailtoUrl).toMatch(/^mailto:\?subject=/);

    const publicPath = new URL(share.body.pdfUrl).pathname;
    const publicPdf = await requestPdf(publicPath);
    expect(publicPdf.status).toBe(200);
    expect(publicPdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    const signed = signInvoiceLinkToken(benchmark.ids.invoiceA);
    const pieces = signed.split('.');
    pieces[2] = `${pieces[2][0] === 'a' ? 'b' : 'a'}${pieces[2].slice(1)}`;
    const tampered = pieces.join('.');
    const expired = signInvoiceLinkToken(benchmark.ids.invoiceA, {
      now: new Date(Date.now() - 5000),
      ttlSeconds: 1
    });
    const loginJwt = benchmark.tokens.admin;
    const badTokens = [tampered, expired, loginJwt];
    for (const token of badTokens) {
      const response = await request(app).get(`/api/public/invoices/${token}/pdf`);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_LINK');
    }

    const missing = signInvoiceLinkToken(2147483647);
    const deletedInvoice = await request(app).get(`/api/public/invoices/${missing}/pdf`);
    expect(deletedInvoice.status).toBe(404);
  });
});
