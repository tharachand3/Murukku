import { describe, expect, it } from 'vitest';
import {
  batchesFromIssue,
  planFromBatches,
  planFromTargetOutput
} from '../../src/lib/bomMath.js';

const bom = {
  batchYieldQty: 200,
  lines: [
    { itemId: 1, qtyPerBatch: 40000 },
    { itemId: 2, qtyPerBatch: 10000 },
    { itemId: 3, qtyPerBatch: 1200 },
    { itemId: 4, qtyPerBatch: 200 },
    { itemId: 5, qtyPerBatch: 10 }
  ]
};

function quantities(plan) {
  return Object.fromEntries(plan.lines.map(({ itemId, plannedQty }) => [itemId, plannedQty]));
}

describe('BOM planning math', () => {
  it('plans one complete benchmark batch in integer base units', () => {
    const planned = planFromBatches(bom, '1');
    expect(planned.batchCount.toString()).toBe('1');
    expect(planned.plannedOutputQty).toBe(200);
    expect(quantities(planned)).toEqual({
      1: 40000,
      2: 10000,
      3: 1200,
      4: 200,
      5: 10
    });
  });

  it('scales a fractional batch with half-up integer rounding', () => {
    const twoAndHalf = planFromBatches(bom, '2.5');
    expect(twoAndHalf.batchCount.toString()).toBe('2.5');
    expect(twoAndHalf.plannedOutputQty).toBe(500);
    expect(quantities(twoAndHalf)).toEqual({
      1: 100000,
      2: 25000,
      3: 3000,
      4: 500,
      5: 25
    });

    const third = planFromBatches(bom, '0.333');
    expect(third.plannedOutputQty).toBe(67);
    expect(quantities(third)).toEqual({
      1: 13320,
      2: 3330,
      3: 400,
      4: 67,
      5: 3
    });
    expect(third.lines.every(({ plannedQty }) => Number.isInteger(plannedQty))).toBe(true);
  });

  it('plans batches from a target output and rounds batch count to four decimals', () => {
    const planned = planFromTargetOutput(bom, 300);
    expect(planned.batchCount.toString()).toBe('1.5');
    expect(planned.plannedOutputQty).toBe(300);
    expect(quantities(planned)).toEqual({
      1: 60000,
      2: 15000,
      3: 1800,
      4: 300,
      5: 15
    });
  });

  it('infers batches and expected output from an issued material quantity', () => {
    const planned = batchesFromIssue(bom, 1, 20000);
    expect(planned.batchCount.toString()).toBe('0.5');
    expect(planned.plannedOutputQty).toBe(100);
    expect(quantities(planned)).toEqual({
      1: 20000,
      2: 5000,
      3: 600,
      4: 100,
      5: 5
    });
  });

  it('rejects unknown BOM items and batch counts outside the supported range', () => {
    expect(() => batchesFromIssue(bom, 99, 100)).toThrow(/not in the BOM/);
    expect(() => planFromBatches(bom, 0)).toThrow(/batchCount/);
    expect(() => planFromBatches(bom, 101)).toThrow(/batchCount/);
    expect(() => planFromBatches(bom, '0.00001')).toThrow(/batchCount/);
    expect(() => planFromBatches(bom, '100.0001')).toThrow(/batchCount/);
  });
});
