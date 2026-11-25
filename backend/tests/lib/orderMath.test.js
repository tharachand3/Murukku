import { describe, expect, it } from 'vitest';
import {
  effectivePricePaise,
  effectiveQty,
  lineTaxablePaise,
  orderTaxablePaise
} from '../../src/lib/orderMath.js';

describe('orderMath', () => {
  it('uses approved values when present and sums integer taxable amounts', () => {
    const lines = [
      { qty: 10, pricePaise: 5000 },
      {
        qty: 4,
        pricePaise: 5000,
        approvedQty: 3,
        approvedPricePaise: 4800
      }
    ];

    expect(effectiveQty(lines[1])).toBe(3);
    expect(effectivePricePaise(lines[1])).toBe(4800);
    expect(lineTaxablePaise(lines[0])).toBe(50000);
    expect(orderTaxablePaise(lines)).toBe(64400);
    expect(effectiveQty({ qty: 2, approvedQty: null })).toBe(2);
    expect(effectivePricePaise({ pricePaise: 5000, approvedPricePaise: null }))
      .toBe(5000);
  });
});
