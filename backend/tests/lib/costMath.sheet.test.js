import { describe, expect, it } from 'vitest';
import {
  formatMarginPct,
  lineCostVariance,
  marginPerPacket,
  splitCostPerPacket
} from '../../src/lib/costMath.js';

describe('cost sheet math', () => {
  it('splits material and overhead costs per good packet', () => {
    const result = splitCostPerPacket({
      materialCostPaise: 405500,
      overheadCostPaise: 180000,
      goodQty: 188
    });

    expect(result.materialPerPacket.toFixed(4)).toBe('2156.9149');
    expect(result.overheadPerPacket.toFixed(4)).toBe('957.4468');
    expect(result.totalPerPacket.toFixed(4)).toBe('3114.3617');
  });

  it('computes positive and negative per-packet margins with integer basis points', () => {
    const positive = marginPerPacket({
      sellingPricePaise: 5000,
      costPerPacketPaise: '3114.3617'
    });
    expect(positive.marginPaise.toFixed(4)).toBe('1885.6383');
    expect(positive.marginBp).toBe(3771);
    expect(formatMarginPct(positive.marginBp)).toBe('37.71%');

    const negative = marginPerPacket({
      sellingPricePaise: 5000,
      costPerPacketPaise: '5250'
    });
    expect(negative.marginBp).toBe(-500);
    expect(formatMarginPct(negative.marginBp)).toBe('-5.00%');
  });

  it('returns null when good quantity is zero or margin inputs are unavailable', () => {
    expect(splitCostPerPacket({
      materialCostPaise: 405500,
      overheadCostPaise: 180000,
      goodQty: 0
    })).toBeNull();
    expect(marginPerPacket({
      sellingPricePaise: null,
      costPerPacketPaise: '3114.3617'
    })).toBeNull();
    expect(marginPerPacket({
      sellingPricePaise: 0,
      costPerPacketPaise: '3114.3617'
    })).toBeNull();
  });

  it.each([
    [10000, 10500, '14', 140000, 147000, 7000],
    [200, 194, '250', 50000, 48500, -1500]
  ])('computes line cost variance for %i planned and %i issued', (
    plannedQty,
    issuedQty,
    ratePaisePerBase,
    plannedCostPaise,
    actualCostPaise,
    costVariancePaise
  ) => {
    expect(lineCostVariance({ plannedQty, issuedQty, ratePaisePerBase })).toEqual({
      plannedCostPaise,
      actualCostPaise,
      costVariancePaise
    });
  });
});
