import { describe, expect, it } from 'vitest';
import { addDays, formatDateIST, formatDateTimeIST, rangePreset, todayIST } from './date.js';

describe('IST date helpers', () => {
  it('uses the IST calendar day across the 18:30 UTC boundary', () => {
    expect(todayIST(new Date('2026-11-24T18:29:59.000Z'))).toBe('2026-11-24');
    expect(todayIST(new Date('2026-11-24T18:30:00.000Z'))).toBe('2026-11-25');
    expect(formatDateIST('2026-11-24T18:30:00.000Z')).toBe('25-Nov-2026');
    expect(formatDateTimeIST('2026-11-24T13:00:00.000Z')).toBe('24-Nov-2026 18:30');
    expect(formatDateIST('2026-11-24')).toBe('24-Nov-2026');
  });

  it('adds calendar days without timezone drift', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01');
    expect(addDays('2026-04-01', -1)).toBe('2026-03-31');
  });

  it('builds IST date range presets and crosses the financial-year boundary', () => {
    const beforeFy = new Date('2026-03-31T18:29:00.000Z');
    const afterFy = new Date('2026-03-31T18:30:00.000Z');
    expect(rangePreset('thisFY', beforeFy)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(rangePreset('thisFY', afterFy)).toEqual({ from: '2026-04-01', to: '2026-04-01' });
    expect(rangePreset('last7', new Date('2026-11-24T18:30:00.000Z')))
      .toEqual({ from: '2026-11-19', to: '2026-11-25' });
    expect(rangePreset('lastMonth', new Date('2026-01-15T12:00:00.000Z')))
      .toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});
