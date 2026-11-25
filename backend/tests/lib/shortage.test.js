import { describe, expect, it } from 'vitest';
import { computeShortage } from '../../src/lib/shortage.js';

describe('computeShortage', () => {
  it('covers an order when on-hand stock is sufficient', () => {
    expect(computeShortage({ requested: 150, onHand: 238, reserved: 0 }))
      .toEqual({ free: 238, shortBy: 0, covered: true });
  });

  it('reports the uncovered amount when stock is short', () => {
    expect(computeShortage({ requested: 120, onHand: 88, reserved: 0 }))
      .toEqual({ free: 88, shortBy: 32, covered: false });
  });

  it('subtracts existing reservations before checking coverage', () => {
    expect(computeShortage({ requested: 120, onHand: 238, reserved: 150 }))
      .toEqual({ free: 88, shortBy: 32, covered: false });
  });

  it('never returns negative free stock when reservations exceed on-hand', () => {
    expect(computeShortage({ requested: 1, onHand: 10, reserved: 12 }))
      .toEqual({ free: 0, shortBy: 1, covered: false });
  });

  it('covers a zero-quantity request', () => {
    expect(computeShortage({ requested: 0, onHand: 0, reserved: 0 }))
      .toEqual({ free: 0, shortBy: 0, covered: true });
  });

  it('rejects non-integer or negative quantities', () => {
    expect(() => computeShortage({ requested: 1.5, onHand: 2, reserved: 0 }))
      .toThrow(RangeError);
    expect(() => computeShortage({ requested: 1, onHand: -1, reserved: 0 }))
      .toThrow(RangeError);
  });
});
