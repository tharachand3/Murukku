import { describe, expect, it } from 'vitest';
import { cellTone, formatCellDisplay } from './reportFormat.js';

describe('report cell formatting', () => {
  it.each([
    [787500, 'money', 'Rs 7,875.00'],
    ['1234.56', 'moneyDecimal', 'Rs 12.35'],
    [-600, 'percentBp', '-6.00%'],
    [12345678, 'int', '1,23,45,678'],
    ['2026-04-01', 'date', '01-Apr-2026'],
    ['0.125', 'decimal', '0.125'],
    ['INV/FY/0001', 'text', 'INV/FY/0001']
  ])('formats %s as %s', (value, type, expected) => {
    expect(formatCellDisplay(value, type)).toBe(expected);
  });

  it.each(['text', 'date', 'int', 'money', 'moneyDecimal', 'decimal', 'percentBp'])(
    'renders null %s cells as a dash',
    (type) => {
      expect(formatCellDisplay(null, type)).toBe('-');
    }
  );

  it('marks flags and negative variance percentages as dangerous', () => {
    expect(cellTone({ key: 'yieldFlagged', type: 'text' }, 'YES')).toBe('danger');
    expect(cellTone({ key: 'reconciles', type: 'text' }, 'MISMATCH')).toBe('danger');
    expect(cellTone({ key: 'variancePctBp', type: 'percentBp' }, -600)).toBe('danger');
    expect(cellTone({ key: 'variancePctBp', type: 'percentBp' }, 600)).toBeNull();
    expect(cellTone({ key: 'sharePctBp', type: 'percentBp' }, -600)).toBeNull();
  });
});
