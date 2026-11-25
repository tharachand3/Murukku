import { describe, expect, it } from 'vitest';
import { istDayRange } from '../../src/lib/istDate.js';

describe('istDayRange', () => {
  it('converts an inclusive IST calendar day to a half-open UTC range', () => {
    expect(istDayRange('2026-03-10', '2026-03-10')).toEqual({
      gte: new Date('2026-03-09T18:30:00.000Z'),
      lt: new Date('2026-03-10T18:30:00.000Z')
    });
  });

  it('includes 23:30 IST on the to-date and excludes 00:30 IST the next day', () => {
    const { gte, lt } = istDayRange('2026-03-10', '2026-03-10');
    const at2330 = new Date('2026-03-10T18:00:00.000Z');
    const nextDay0030 = new Date('2026-03-10T19:00:00.000Z');

    expect(at2330 >= gte && at2330 < lt).toBe(true);
    expect(nextDay0030 >= gte && nextDay0030 < lt).toBe(false);
  });

  it.each(['2026-02-29', '2026-13-01', '2026-3-10', 'not-a-date'])(
    'rejects invalid date %s',
    (value) => {
      expect(() => istDayRange(value, undefined)).toThrow();
    }
  );

  it('rejects a from-date later than the to-date', () => {
    expect(() => istDayRange('2026-03-11', '2026-03-10')).toThrow();
  });
});
