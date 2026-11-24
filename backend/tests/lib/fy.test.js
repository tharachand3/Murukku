import { describe, expect, it } from 'vitest';
import {
  currentFinancialYear,
  financialYearOf,
  financialYearRange
} from '../../src/lib/fy.js';

describe('financial year helpers', () => {
  it('uses the Asia/Kolkata calendar date at the April boundary', () => {
    expect(financialYearOf(new Date('2027-03-31T18:00:00.000Z'))).toBe('2026-27');
    expect(financialYearOf(new Date('2027-03-31T19:00:00.000Z'))).toBe('2027-28');
  });

  it('returns UTC instants for the IST-midnight FY boundaries', () => {
    const range = financialYearRange('2026-27');
    expect(range.start.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(range.end.toISOString()).toBe('2027-03-31T18:30:00.000Z');
  });

  it('reports the current financial year from the current instant', () => {
    expect(currentFinancialYear()).toBe(financialYearOf(new Date()));
  });
});
