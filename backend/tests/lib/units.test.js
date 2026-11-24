import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  UNITS,
  convert,
  formatQty,
  fromBase,
  packetsToCartons,
  toBase
} from '../../src/lib/units.js';

describe('unit helpers', () => {
  it('defines base factors and converts quantities to base units', () => {
    expect(UNITS.kg).toEqual({ dimension: 'MASS', factor: 1000 });
    expect(toBase('10.5', 'l')).toBe(10500);
    expect(toBase('1.2', 'kg')).toBe(1200);
    expect(() => toBase('0.0005', 'kg')).toThrow(/safe integer/);
  });

  it('converts and formats quantities without losing decimal precision', () => {
    expect(fromBase(10500, 'l').equals(new Decimal('10.5'))).toBe(true);
    expect(formatQty(10500, 'l')).toBe('10.5 l');
    expect(convert('1.5', 'kg', 'g').equals(new Decimal(1500))).toBe(true);
    expect(() => convert(1, 'kg', 'l')).toThrow(/Cannot convert/);
  });

  it('splits packets into full cartons and loose packets', () => {
    expect(packetsToCartons(238, 20)).toEqual({
      cartons: 11,
      loosePackets: 18
    });
  });
});
