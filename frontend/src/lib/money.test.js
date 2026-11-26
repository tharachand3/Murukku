import { describe, expect, it } from 'vitest';
import {
  formatBp,
  formatPaise,
  formatPaiseDecimal,
  parseRupeesToPaise,
  paiseToInput
} from './money.js';

describe('money helpers', () => {
  it.each([
    [787500, 'Rs 7,875.00'],
    [12345678, 'Rs 1,23,456.78'],
    [5, 'Rs 0.05'],
    [0, 'Rs 0.00'],
    [-440000, '-Rs 4,400.00'],
    ['787500', 'Rs 7,875.00']
  ])('formats %s integer paise', (amount, expected) => {
    expect(formatPaise(amount)).toBe(expected);
  });

  it('rounds decimal-string costs half-up without float conversion', () => {
    expect(formatPaiseDecimal('3114.3617')).toBe('Rs 31.14');
    expect(formatPaiseDecimal('3114.365')).toBe('Rs 31.14');
    expect(formatPaiseDecimal('3114.375')).toBe('Rs 31.14');
    expect(formatPaiseDecimal('3114.5')).toBe('Rs 31.15');
  });

  it.each([
    ['50', 5000],
    ['1,234.5', 123450],
    ['0.05', 5],
    ['10,00,00,000', 10000000000]
  ])('parses %s rupees into integer paise', (text, expected) => {
    expect(parseRupeesToPaise(text)).toBe(expected);
  });

  it.each(['', '-5', '1.234', 'abc', '10,000,00', '10,00,00,000.01'])(
    'rejects invalid rupee input %s',
    (text) => expect(() => parseRupeesToPaise(text)).toThrow()
  );

  it('converts input values and formats basis points with integer arithmetic', () => {
    expect(paiseToInput(787500)).toBe('7875.00');
    expect(formatBp(-600)).toBe('-6.00%');
    expect(formatBp(3771)).toBe('37.71%');
    expect(formatBp(5)).toBe('0.05%');
  });
});
