import { describe, expect, it } from 'vitest';
import {
  formatRupees,
  rateForDisplayUnit,
  valueAt,
  weightedAverage
} from '../src/lib/costMath.js';

describe('cost math', () => {
  it('calculates weighted average rates from priced receipts at six decimals', () => {
    expect(weightedAverage([
      { qty: 100000, valuePaise: 420000 },
      { qty: 60000, valuePaise: 270000 }
    ]).toString()).toBe('4.3125');
    expect(weightedAverage([
      { qty: 1, valuePaise: 1 }
    ]).toString()).toBe('1');
    expect(weightedAverage([
      { qty: 3, valuePaise: 1 }
    ]).toString()).toBe('0.333333');
  });

  it('returns null for no positive receipt quantity', () => {
    expect(weightedAverage([])).toBeNull();
    expect(weightedAverage([{ qty: 0, valuePaise: 100 }])).toBeNull();
  });

  it('converts rates and values without floating-point arithmetic', () => {
    expect(rateForDisplayUnit('4.3125', 1000).toString()).toBe('4312.5');
    expect(valueAt('4.3125', 40000)).toBe(172500);
  });

  it('formats rupees with Indian grouping and trimmed fractional zeros', () => {
    expect(formatRupees('4312.5')).toBe('Rs 43.125');
    expect(formatRupees(14000)).toBe('Rs 140.00');
    expect(formatRupees(250)).toBe('Rs 2.50');
    expect(formatRupees(123456789)).toBe('Rs 12,34,567.89');
  });
});
