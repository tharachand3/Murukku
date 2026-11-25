import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CAPABILITY_MATRIX } from '../src/config/permissions.js';
import { AppError } from '../src/lib/errors.js';
import { getReport, registerReport } from '../src/services/reports/index.js';
import salesRegister from '../src/services/reports/salesRegister.js';
import {
  COLUMN_TYPES,
  defineReport,
  makeSection,
  paginate,
  pageFilterShape,
  periodFilterShape,
  resolvePeriod,
  sumMoneyColumns
} from '../src/lib/reportKit.js';
import { currentFinancialYear } from '../src/lib/fy.js';
import { istDayRange } from '../src/lib/istDate.js';

function validDefinition(overrides = {}) {
  return {
    key: 'test-report',
    title: 'Test report',
    description: 'A report used by unit tests.',
    group: 'sales',
    capability: 'reports:read',
    filtersSchema: z.object({}).strict(),
    filterDocs: [],
    run: async () => ({ title: 'Test report', period: {}, sections: [] }),
    ...overrides
  };
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

describe('report kit', () => {
  it('validates report definitions at import time', () => {
    expect(defineReport(validDefinition())).toMatchObject({ key: 'test-report' });
    expect(Object.isFrozen(defineReport(validDefinition()))).toBe(true);
    expect(() => defineReport(validDefinition({ key: 'Not Valid' }))).toThrow();
    expect(() => defineReport(validDefinition({ group: 'unknown' }))).toThrow();
    expect(() => defineReport(validDefinition({ capability: 'missing:read' }))).toThrow();
    expect(() => defineReport(validDefinition({ filtersSchema: {} }))).toThrow();
    expect(Object.keys(CAPABILITY_MATRIX)).toContain('reports:read');
  });

  it('rejects duplicate report keys in the registry', () => {
    const existing = getReport('sales-register');
    const definition = defineReport(validDefinition({ key: 'sales-register' }));
    expect(existing).toBeDefined();
    expect(() => registerReport(definition)).toThrow('Report already registered');
    expect(getReport('sales-register')).toBe(existing);
  });

  it('resolves default financial-year periods and rejects invalid or long periods', () => {
    const now = new Date();
    const defaults = resolvePeriod({}, now);
    expect(defaults.fromDate).toBe(`${currentFinancialYear(now).slice(0, 4)}-04-01`);
    expect(defaults.toDate).toBe(istDate(now));
    expect(defaults.start).toEqual(istDayRange(defaults.fromDate, defaults.toDate).gte);
    expect(defaults.endExclusive).toEqual(istDayRange(defaults.fromDate, defaults.toDate).lt);
    expect(resolvePeriod({ from: defaults.toDate, to: defaults.toDate }).fromDate)
      .toBe(defaults.toDate);

    let invalidPeriod;
    try {
      resolvePeriod({ from: defaults.toDate, to: shiftDate(defaults.toDate, -1) });
    } catch (error) {
      invalidPeriod = error;
    }
    expect(invalidPeriod).toMatchObject({ status: 400, code: 'INVALID_PERIOD' });
    const longFrom = shiftDate(defaults.toDate, -732);
    let longPeriod;
    try {
      resolvePeriod({ from: longFrom, to: defaults.toDate });
    } catch (error) {
      longPeriod = error;
    }
    expect(longPeriod).toMatchObject({ status: 422, code: 'PERIOD_TOO_LONG' });
    expect(periodFilterShape.safeParse({ from: 'not-a-date' }).success).toBe(false);
  });

  it('uses inclusive IST days with an exclusive next-day boundary', () => {
    const day = istDate(new Date());
    const nextDay = shiftDate(day, 1);
    const period = resolvePeriod({ from: day, to: day });
    const at2330 = new Date(`${day}T23:30:00+05:30`);
    const at0030Next = new Date(`${nextDay}T00:30:00+05:30`);
    expect(at2330 >= period.start && at2330 < period.endExclusive).toBe(true);
    expect(at0030Next >= period.start && at0030Next < period.endExclusive).toBe(false);
    expect(resolvePeriod({ from: nextDay, to: nextDay }).start.getTime())
      .toBe(period.endExclusive.getTime());
  });

  it('paginates with stable page metadata and validates page filters', () => {
    const result = paginate(['a', 'b', 'c', 'd', 'e'], { page: 2, limit: 2 });
    expect(result).toEqual({
      rows: ['c', 'd'],
      page: { page: 2, limit: 2, total: 5, pages: 3 }
    });
    expect(pageFilterShape.parse({}).page).toBe(1);
    expect(pageFilterShape.parse({}).limit).toBe(50);
    expect(() => paginate([], { page: 0, limit: 1 })).toThrow(RangeError);
  });

  it('normalizes section rows, validates numeric columns, and sums integer money', () => {
    expect(COLUMN_TYPES).toContain('moneyDecimal');
    const section = makeSection({
      key: 'sample',
      title: 'Sample',
      columns: [
        { key: 'amount', label: 'Amount', type: 'money' },
        { key: 'note', label: 'Note', type: 'text' }
      ],
      rows: [{ amount: 125 }]
    });
    expect(section.rows).toEqual([{ amount: 125, note: null }]);
    expect(() => makeSection({
      key: 'sample',
      title: 'Sample',
      columns: [{ key: 'amount', label: 'Amount', type: 'money' }],
      rows: [{ amount: 1.5 }]
    })).toThrow();
    expect(() => makeSection({
      key: 'sample',
      title: 'Sample',
      columns: [{ key: 'amount', label: 'Amount', type: 'money' }],
      rows: [{ amount: 1, extra: true }]
    })).toThrow();
    expect(() => makeSection({
      key: 'sample',
      title: 'Sample',
      columns: [{ key: 'amount', label: 'Amount', type: 'unknown' }],
      rows: []
    })).toThrow();
    expect(sumMoneyColumns([{ a: 10, b: -2 }, { a: 5, b: 4 }], ['a', 'b']))
      .toEqual({ a: 15, b: 2 });
    expect(() => sumMoneyColumns([{ a: 1.25 }], ['a'])).toThrow();
  });

  it('returns all rows without pagination metadata when requested', async () => {
    const invoice = {
      id: 1,
      invoiceNo: 'INV/test/0001',
      issueDate: new Date(),
      placeOfSupplyStateCode: '33',
      isInterState: false,
      taxableValuePaise: 100,
      cgstPaise: 3,
      sgstPaise: 3,
      igstPaise: 0,
      totalPaise: 106,
      status: 'POSTED',
      customer: { name: 'Customer', gstin: null },
      lines: [{ qty: 1 }],
      creditNotes: []
    };
    const db = {
      invoice: {
        findMany: vi.fn().mockResolvedValue([invoice]),
        groupBy: vi.fn().mockResolvedValue([{
          status: 'POSTED',
          _count: { _all: 1 },
          _sum: {
            taxableValuePaise: 100,
            cgstPaise: 3,
            sgstPaise: 3,
            igstPaise: 0,
            totalPaise: 106
          }
        }])
      }
    };
    const report = await salesRegister.run(db, {
      page: 1,
      limit: 50,
      status: 'ALL',
      taxType: 'ALL'
    }, { all: true });
    expect(report.sections[0].rows).toHaveLength(1);
    expect(report.sections[0].page).toBeNull();
    expect(db.invoice.findMany).toHaveBeenCalledTimes(1);
    expect(db.invoice.groupBy).toHaveBeenCalledTimes(1);
  });

  it('caps all-row reports at 50000 records', async () => {
    const db = {
      invoice: {
        findMany: vi.fn().mockResolvedValue(new Array(50001)),
        groupBy: vi.fn().mockResolvedValue([])
      }
    };
    await expect(salesRegister.run(db, {
      page: 1,
      limit: 50,
      status: 'ALL',
      taxType: 'ALL'
    }, { all: true })).rejects.toMatchObject({
      status: 422,
      code: 'TOO_MANY_ROWS'
    });
  });
});
