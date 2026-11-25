import { describe, expect, it } from 'vitest';
import { allocateFifo, batchesNeeded } from '../src/lib/planning.js';

describe('stock planning helpers', () => {
  it('allocates available stock to oldest orders first', () => {
    expect(allocateFifo(88, [
      { orderId: 1, qty: 120 },
      { orderId: 2, qty: 50 }
    ])).toEqual([
      { orderId: 1, qty: 120, allocated: 88, shortBy: 32 },
      { orderId: 2, qty: 50, allocated: 0, shortBy: 50 }
    ]);
  });

  it('covers ordered demand when stock is sufficient', () => {
    expect(allocateFifo(300, [
      { orderId: 1, qty: 120 },
      { orderId: 2, qty: 50 }
    ])).toEqual([
      { orderId: 1, qty: 120, allocated: 120, shortBy: 0 },
      { orderId: 2, qty: 50, allocated: 50, shortBy: 0 }
    ]);
  });

  it('rounds suggested production batches up to whole batches', () => {
    expect(batchesNeeded(32, 200)).toBe(1);
    expect(batchesNeeded(201, 200)).toBe(2);
    expect(batchesNeeded(0, 200)).toBe(0);
    expect(() => batchesNeeded(1, 0)).toThrow(RangeError);
  });
});
