import { describe, expect, it } from 'vitest';
import { isLow, summarizeAlerts } from './alerts.js';

describe('alert helpers', () => {
  it('treats a balance at the reorder boundary as low', () => {
    expect(isLow(150000, 150000)).toBe(true);
    expect(isLow(149999, 150000)).toBe(true);
  });

  it('does not infer low stock when either quantity is missing or invalid', () => {
    expect(isLow(10, undefined)).toBe(false);
    expect(isLow(null, 10)).toBe(false);
    expect(isLow(10.5, 11)).toBe(false);
  });

  it('counts shortages as one alert and excludes sections that were not loaded', () => {
    expect(summarizeAlerts({
      flaggedRuns: 1,
      lowItems: 1,
      shortPackets: 32
    })).toEqual({
      total: 3,
      flaggedRuns: 1,
      lowItems: 1,
      shortPackets: 32
    });
    expect(summarizeAlerts({ flaggedRuns: 2 })).toEqual({
      total: 2,
      flaggedRuns: 2,
      lowItems: undefined,
      shortPackets: undefined
    });
    expect(summarizeAlerts({})).toEqual({
      total: 0,
      flaggedRuns: undefined,
      lowItems: undefined,
      shortPackets: undefined
    });
  });
});
