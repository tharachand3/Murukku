import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  excelValue,
  formatCell,
  formatCellDisplay
} from '../src/lib/exportFormat.js';
import { toCsv } from '../src/services/reports/exporters/csv.js';
import { toPdf } from '../src/services/reports/exporters/pdf.js';
import { toXlsx } from '../src/services/reports/exporters/xlsx.js';
import { assertExportRowCap } from '../src/services/reports/exporters/cap.js';

describe('report export formatting', () => {
  it('handles null and zero consistently for every column type', () => {
    const values = {
      text: '0',
      date: '0',
      int: '0',
      money: '0.00',
      moneyDecimal: '0.00',
      decimal: '0',
      percentBp: '0.00'
    };
    for (const [type, zero] of Object.entries(values)) {
      expect(formatCell(null, type)).toBe('');
      expect(formatCell(undefined, type)).toBe('');
      const input = type === 'decimal' || type === 'moneyDecimal' ? '0' : 0;
      expect(formatCell(input, type)).toBe(zero);
    }
  });

  it('formats all supported cell types without floating-point money math', () => {
    expect(formatCell(null, 'text')).toBe('');
    expect(formatCell(undefined, 'money')).toBe('');
    expect(formatCell('hello', 'text')).toBe('hello');
    expect(formatCell('date-value', 'date')).toBe('date-value');
    expect(formatCell(-42, 'int')).toBe('-42');
    expect(formatCell(0, 'int')).toBe('0');
    expect(formatCell(787500, 'money')).toBe('7875.00');
    expect(formatCell(-440000, 'money')).toBe('-4400.00');
    expect(formatCell(5, 'money')).toBe('0.05');
    expect(formatCell(0, 'money')).toBe('0.00');
    expect(formatCell('3114.3617', 'moneyDecimal')).toBe('31.14');
    expect(formatCell('0.5', 'moneyDecimal')).toBe('0.01');
    expect(formatCell('-600', 'percentBp')).toBe('-6.00');
    expect(formatCell(3771, 'percentBp')).toBe('37.71');
    expect(formatCell(5, 'percentBp')).toBe('0.05');
    expect(formatCell('1.2300', 'decimal')).toBe('1.2300');
  });

  it('guards spreadsheet formulas only in text values', () => {
    for (const value of ['=1+1', '+91', '-x', '@a', '\tvalue', '\rvalue']) {
      expect(formatCell(value, 'text')).toBe(`'${value}`);
    }
    expect(formatCell(-500, 'money')).toBe('-5.00');
    expect(formatCell(-5, 'int')).toBe('-5');
    expect(formatCellDisplay('=1+1', 'text')).toBe('=1+1');
    expect(formatCellDisplay(787500, 'money')).toBe('7,875.00');
    expect(formatCellDisplay(-600, 'percentBp')).toBe('-6.00%');
  });

  it('converts typed values to Excel values and formats', () => {
    expect(excelValue(787500, 'money')).toEqual({
      value: 7875,
      numFmt: '#,##0.00'
    });
    expect(excelValue('3114.3617', 'moneyDecimal')).toEqual({
      value: 31.14,
      numFmt: '#,##0.00'
    });
    expect(excelValue(-5, 'int')).toEqual({ value: -5, numFmt: '#,##0' });
    expect(excelValue(3771, 'percentBp')).toEqual({
      value: 0.3771,
      numFmt: '0.00%'
    });
    expect(excelValue('1.25', 'decimal')).toEqual({ value: 1.25, numFmt: undefined });
    expect(excelValue('not numeric', 'decimal')).toEqual({
      value: 'not numeric',
      numFmt: undefined
    });
    expect(excelValue('=SUM(1)', 'text').value).toBe("'=SUM(1)");
    expect(excelValue('date-value', 'date').value).toBe('date-value');
    expect(excelValue(null, 'money')).toEqual({ value: null, numFmt: undefined });
  });

  it('writes BOM-prefixed RFC 4180 CSV with totals and protected text', () => {
    const result = {
      sections: [{
        key: 'items',
        columns: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'amountPaise', label: 'Amount', type: 'money' }
        ],
        rows: [
          { name: 'comma, quote " and\nline', amountPaise: 787500 },
          { name: '=SUM(1)', amountPaise: -440000 }
        ],
        totals: { amountPaise: 347500 }
      }]
    };
    const csv = toCsv(result);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('"comma, quote "" and\nline",7875.00');
    expect(csv).toContain("'=SUM(1),-4400.00");
    expect(csv.endsWith('Total,3475.00\r\n')).toBe(true);
  });

  it('rejects unknown CSV sections and export row counts above the cap', () => {
    const result = {
      sections: [{
        key: 'one',
        columns: [{ key: 'name', label: 'Name', type: 'text' }],
        rows: []
      }]
    };
    expect(() => toCsv(result, { sectionKey: 'missing' }))
      .toThrow(expect.objectContaining({ code: 'UNKNOWN_SECTION', status: 400 }));
    expect(assertExportRowCap(50000)).toBeUndefined();
    expect(() => assertExportRowCap(50001))
      .toThrow(expect.objectContaining({ code: 'TOO_MANY_ROWS', status: 422 }));
  });

  it('creates a frozen, formatted workbook with report information', async () => {
    const result = {
      title: 'Sales Register',
      period: {},
      generatedAt: new Date().toISOString(),
      filters: {},
      sections: [{
        key: 'invoices',
        title: 'Invoices',
        columns: [
          { key: 'invoiceNo', label: 'Invoice no.', type: 'text' },
          { key: 'totalPaise', label: 'Total', type: 'money' }
        ],
        rows: [{ invoiceNo: 'INV/FY/0001', totalPaise: 787500 }],
        totals: { totalPaise: 787500 }
      }]
    };
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await toXlsx(result));
    const sheet = workbook.getWorksheet('Invoices');
    expect(workbook.worksheets.map(({ name }) => name)).toContain('Report info');
    expect(sheet.getCell('B2').value).toBe(7875);
    expect(sheet.getCell('B2').numFmt).toBe('#,##0.00');
    expect(sheet.getRow(1).font.bold).toBe(true);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('renders PDFs and paginates large result sets', async () => {
    const result = {
      title: 'Synthetic report',
      period: {},
      generatedAt: new Date().toISOString(),
      sections: [{
        key: 'rows',
        title: 'Rows',
        columns: [{ key: 'name', label: 'Name', type: 'text' }],
        rows: Array.from({ length: 300 }, (_, index) => ({ name: `row ${index + 1}` }))
      }]
    };
    const pdf = await toPdf(result);
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect((text.match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
