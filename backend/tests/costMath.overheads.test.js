import { describe, expect, it } from 'vitest';
import { computeRunCost, formatPaiseDecimalAsRupees } from '../src/lib/costMath.js';

describe('production run cost math', () => {
  it('allocates material and overhead over good packets using four-place half-up rounding', () => {
    const result = computeRunCost({
      materialCostPaise: 405500,
      overheadCostPaise: 180000,
      goodQty: 188
    });

    expect(result.totalCostPaise).toBe(585500);
    expect(result.costPerPacketPaise.toFixed(4)).toBe('3114.3617');
    expect(formatPaiseDecimalAsRupees(result.costPerPacketPaise)).toBe('Rs 31.14');
  });

  it('computes material-only cost when overhead is zero', () => {
    const result = computeRunCost({
      materialCostPaise: 405500,
      overheadCostPaise: 0,
      goodQty: 188
    });

    expect(result.totalCostPaise).toBe(405500);
    expect(result.costPerPacketPaise.toFixed(4)).toBe('2156.9149');
  });

  it.each([undefined, 0])('does not divide by zero or missing good quantity (%s)', (goodQty) => {
    expect(computeRunCost({
      materialCostPaise: 405500,
      overheadCostPaise: 180000,
      goodQty
    })).toEqual({
      totalCostPaise: 585500,
      costPerPacketPaise: null
    });
  });
});
