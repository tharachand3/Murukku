import { describe, expect, it } from 'vitest';
import { paiseToWords } from '../../src/lib/amountInWords.js';

describe('paiseToWords', () => {
  it.each([
    [0, 'Rupees Zero Only'],
    [100, 'Rupees One Only'],
    [150, 'Rupees One and Fifty Paise Only'],
    [5, 'Five Paise Only'],
    [787500, 'Rupees Seven Thousand Eight Hundred Seventy Five Only'],
    [462000, 'Rupees Four Thousand Six Hundred Twenty Only'],
    [630000, 'Rupees Six Thousand Three Hundred Only'],
    [10000000, 'Rupees One Lakh Only'],
    [
      1234567800,
      'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only'
    ],
    [100000000000, 'Rupees One Hundred Crore Only']
  ])('converts %i paise', (paise, expected) => {
    expect(paiseToWords(paise)).toBe(expected);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER, 100000000001, NaN, '100'])(
    'rejects invalid input %s',
    (paise) => {
      expect(() => paiseToWords(paise)).toThrow(RangeError);
    }
  );
});
