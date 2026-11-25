import { MovementType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { classifyMovement, reconcile } from '../../src/lib/stockClassify.js';

const expectedMovements = {
  OPENING: { column: 'openingEntries', qtyChange: 1 },
  PURCHASE: { column: 'purchases', qtyChange: 1 },
  PRODUCTION_ISSUE: { column: 'productionOut', qtyChange: -1 },
  PRODUCTION_OUTPUT: { column: 'productionIn', qtyChange: 1 },
  PRODUCTION_SCRAP: { column: 'scrapOut', qtyChange: -1 },
  DISPATCH: { column: 'dispatchOut', qtyChange: -1 },
  SALES_RETURN: { column: 'returnsIn', qtyChange: 1 },
  ADJUSTMENT: { column: 'adjustmentsIn', qtyChange: 1 }
};

describe('stock movement classification', () => {
  it('classifies every Prisma MovementType enum member', () => {
    expect(Object.values(MovementType).sort())
      .toEqual(Object.keys(expectedMovements).sort());

    for (const [type, expected] of Object.entries(expectedMovements)) {
      expect(classifyMovement(type, expected.qtyChange)).toEqual({
        column: expected.column,
        unclassified: false
      });
    }
  });

  it('splits adjustments by sign and flags unexpected movement directions', () => {
    expect(classifyMovement('ADJUSTMENT', 5)).toEqual({
      column: 'adjustmentsIn',
      unclassified: false
    });
    expect(classifyMovement('ADJUSTMENT', -5)).toEqual({
      column: 'adjustmentsOut',
      unclassified: false
    });
    expect(classifyMovement('PRODUCTION_ISSUE', 5)).toEqual({
      column: 'adjustmentsIn',
      unclassified: true
    });
    expect(classifyMovement('PRODUCTION_OUTPUT', -5)).toEqual({
      column: 'adjustmentsOut',
      unclassified: true
    });
    expect(classifyMovement('FUTURE_MOVEMENT', 5)).toEqual({
      column: 'adjustmentsIn',
      unclassified: true
    });
  });

  it('reconciles stock identity', () => {
    const balances = {
      openingEntries: 100,
      purchases: 60,
      productionIn: 0,
      returnsIn: 0,
      adjustmentsIn: 2,
      productionOut: 40,
      scrapOut: 0,
      dispatchOut: 0,
      adjustmentsOut: 2
    };
    expect(reconcile({ opening: 0, movements: balances, closing: 120 })).toBe(true);
    expect(reconcile({ opening: 0, movements: balances, closing: 121 })).toBe(false);
  });
});
