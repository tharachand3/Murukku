import { describe, expect, it } from 'vitest';
import {
  allocate,
  mulRateQty,
  paiseToRupeesString,
  rupeesToPaise
} from '../../src/lib/money.js';

describe('money helpers', () => {
  it('converts rupees to integer paise with half-up rounding', () => {
    expect(rupeesToPaise('42.5')).toBe(4250);
    expect(rupeesToPaise('42.505')).toBe(4251);
  });

  it('rejects invalid and negative rupee input', () => {
    expect(() => rupeesToPaise('NaN')).toThrow(/finite decimal/);
    expect(() => rupeesToPaise('-0.01')).toThrow(/negative/);
  });

  it('formats integer paise with two decimals and Indian grouping', () => {
    expect(paiseToRupeesString(787500)).toBe('7,875.00');
    expect(paiseToRupeesString(12345600)).toBe('1,23,456.00');
  });

  it('multiplies a decimal per-base-unit rate by an integer quantity', () => {
    expect(mulRateQty('5000', 150)).toBe(750000);
    expect(mulRateQty('0.5', 1)).toBe(1);
  });

  it('allocates every paise using largest remainders', () => {
    const parts = allocate(1000, [1, 1, 1]);
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(1000);
  });

  it('preserves a negative total and rejects unusable weights', () => {
    expect(allocate(-5, [1, 1])).toEqual([-3, -2]);
    expect(() => allocate(10, [0, 0])).toThrow(/greater than zero/);
  });
});
