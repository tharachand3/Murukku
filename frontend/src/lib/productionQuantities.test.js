import { describe, expect, it } from 'vitest';
import {
  formatBaseQuantity,
  formatSignedVariance,
  quantityToBase,
  varianceBasisPoints
} from './productionQuantities.js';

describe('production quantity helpers', () => {
  it('converts display quantities to exact integer base quantities', () => {
    expect(quantityToBase('10.5', 'l', { allowZero: false })).toBe(10500);
    expect(quantityToBase('1.2', 'kg')).toBe(1200);
    expect(formatBaseQuantity(10500, 'l')).toBe('10.5');
    expect(() => quantityToBase('0.0001', 'kg')).toThrow(/exactly representable/);
  });

  it('uses the server basis-point rounding and signed percentage format', () => {
    expect(varianceBasisPoints(200, 188)).toBe(-600);
    expect(varianceBasisPoints(10000, 10500)).toBe(500);
    expect(formatSignedVariance(-600)).toBe('-6.00%');
    expect(formatSignedVariance(500)).toBe('+5.00%');
    expect(formatSignedVariance(0)).toBe('0.00%');
  });
});
