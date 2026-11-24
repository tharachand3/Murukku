import { describe, expect, it } from 'vitest';
import {
  describeVariance,
  isFlagged,
  varianceBp
} from '../../src/lib/variance.js';

describe('variance helpers', () => {
  it('rounds yield and material variance to basis points', () => {
    expect(varianceBp(200, 188)).toBe(-600);
    expect(varianceBp(10000, 10500)).toBe(500);
    expect(varianceBp(200, 194)).toBe(-300);
    expect(varianceBp(10, 9)).toBe(-1000);
  });

  it('rounds half away from zero and uses a strict threshold', () => {
    expect(varianceBp(32, 31)).toBe(-313);
    expect(varianceBp(32, 33)).toBe(313);
    expect(isFlagged(-300, 300)).toBe(false);
    expect(isFlagged(-1000, 300)).toBe(true);
  });

  it('describes a variance and rejects a zero plan', () => {
    expect(describeVariance(200, 188, 300)).toEqual({
      plannedQty: 200,
      actualQty: 188,
      diffQty: -12,
      bp: -600,
      pct: '-6.00',
      flagged: true
    });
    expect(describeVariance(200, 194, 300)).toMatchObject({
      bp: -300,
      flagged: false
    });
    expect(() => varianceBp(0, 1)).toThrow(/must not be zero/);
  });
});
