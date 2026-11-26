import { describe, expect, it } from 'vitest';
import { mulToPaise, parseDecimal } from './decimal.js';

describe('decimal helpers', () => {
  it('parses decimal text without losing its scale', () => {
    expect(parseDecimal('12.340')).toEqual({ n: 12340n, scale: 3 });
  });

  it.each([
    ['60', '45', 1000, 1000, 270000],
    ['100', '2.6', 1, 1, 26000],
    ['10', '46', 1000, 1000, 46000],
    ['0.5', '45', 1000, 1000, 2250],
    ['1', '0.005', 1, 1, 1]
  ])('estimates %s x Rs %s with half-up paise rounding', (qty, rate, baseFactor, unitFactor, expected) => {
    expect(mulToPaise(qty, rate, { baseFactor, unitFactor })).toBe(expected);
  });

  it.each(['', '1e3', '.5', '1.1234567', '1,000'])('rejects invalid decimal text %j', (text) => {
    expect(() => parseDecimal(text)).toThrow(TypeError);
  });

  it('rejects quantities that do not resolve to integer base units', () => {
    expect(() => mulToPaise('0.0001', '45', { baseFactor: 1000, unitFactor: 1000 }))
      .toThrow('Quantity cannot be represented in base units');
  });
});
