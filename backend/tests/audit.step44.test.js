import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { excelValue, formatCell } from '../src/lib/exportFormat.js';
import { toCsv } from '../src/services/reports/exporters/csv.js';
import { toXlsx } from '../src/services/reports/exporters/xlsx.js';
import { apiGet, seedBenchmarkMasters } from './helpers/benchmark.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { db, resetDb } from './helpers/db.js';
import { prisma } from '../src/lib/prisma.js';

let benchmark;

function parseBuffer(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  benchmark = await runBenchmarkFull(app);
}, 180000);

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('step 44 export audit', { timeout: 180000 }, () => {
  it('covers typed formats and guards formula injection in text only', () => {
    expect(formatCell(5, 'money')).toBe('0.05');
    expect(formatCell('3114.3617', 'moneyDecimal')).toBe('31.14');
    expect(formatCell('0.5', 'moneyDecimal')).toBe('0.01');
    expect(formatCell(-600, 'percentBp')).toBe('-6.00');
    expect(formatCell(3771, 'percentBp')).toBe('37.71');
    expect(formatCell('1.2300', 'decimal')).toBe('1.2300');
    expect(formatCell(null, 'money')).toBe('');
    expect(formatCell(undefined, 'decimal')).toBe('');
    expect(formatCell('=1+1', 'text')).toBe("'=1+1");
    expect(formatCell('+91', 'text')).toBe("'+91");
    expect(formatCell('-x', 'text')).toBe("'-x");
    expect(formatCell('@a', 'text')).toBe("'@a");
    expect(formatCell(-440000, 'money')).toBe('-4400.00');
    expect(formatCell(-5, 'int')).toBe('-5');
    expect(excelValue(787500, 'money'))
      .toEqual({ value: 7875, numFmt: '#,##0.00' });
  });

  it('selects CSV sections and writes RFC 4180 values and totals', () => {
    const result = {
      sections: [
        {
          key: 'first',
          columns: [{ key: 'name', label: 'Name', type: 'text' }],
          rows: [{ name: 'first row' }]
        },
        {
          key: 'second',
          columns: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'amount', label: 'Amount', type: 'money' }
          ],
          rows: [{ name: 'comma, quote " and\r\nnewline', amount: 787500 }],
          totals: { amount: 787500 }
        }
      ]
    };
    const csv = toCsv(result, { sectionKey: 'second' });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).toContain('"comma, quote "" and\r\nnewline",7875.00\r\n');
    expect(csv).toContain('Total,7875.00\r\n');
    expect(toCsv(result)).toContain('first row');
    expect(() => toCsv(result, { sectionKey: 'missing' }))
      .toThrow(expect.objectContaining({ code: 'UNKNOWN_SECTION', status: 400 }));
  });

  it('creates one formatted XLSX worksheet per section plus report info', async () => {
    const workbook = new ExcelJS.Workbook();
    const result = {
      title: 'Audit workbook',
      period: {},
      generatedAt: new Date().toISOString(),
      sections: [
        {
          key: 'one',
          title: 'First',
          columns: [{ key: 'total', label: 'Total', type: 'money' }],
          rows: [{ total: 787500 }]
        },
        {
          key: 'two',
          title: 'Second',
          columns: [{ key: 'name', label: 'Name', type: 'text' }],
          rows: [{ name: 'second' }]
        }
      ]
    };
    await workbook.xlsx.load(await toXlsx(result));
    expect(workbook.worksheets.map(({ name }) => name))
      .toEqual(['First', 'Second', 'Report info']);
    expect(workbook.getWorksheet('First').getCell('A2').value).toBe(7875);
    expect(workbook.getWorksheet('First').getCell('A2').numFmt).toBe('#,##0.00');
    expect(workbook.getWorksheet('First').getRow(1).font.bold).toBe(true);
    expect(workbook.getWorksheet('First').views[0])
      .toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('rejects section options on binary exports and lists typed sections', async () => {
    const binarySection = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/sales-register/export?format=xlsx&section=invoices'
    );
    expect(binarySection.status).toBe(400);

    const response = await apiGet(app, benchmark.tokens.admin, '/api/reports');
    expect(response.status).toBe(200);
    const sales = response.body.find(({ key }) => key === 'sales-register');
    expect(sales.exportFormats).toEqual(['csv', 'xlsx', 'pdf']);
    expect(sales.sections).toEqual([
      { key: 'invoices', title: 'Invoices' },
      { key: 'summary', title: 'Summary' }
    ]);

    const exportResponse = await request(app)
      .get('/api/reports/sales-register/export?format=csv')
      .set('Authorization', `Bearer ${benchmark.tokens.accountant}`)
      .buffer(true)
      .parse(parseBuffer);
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers['content-disposition'])
      .toMatch(/^attachment; filename="sales-register_[a-z0-9_.-]+\.csv"$/);
  });
});
