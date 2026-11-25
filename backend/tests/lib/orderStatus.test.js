import { describe, expect, it } from 'vitest';
import { canTransition, ORDER_TRANSITIONS } from '../../src/lib/orderStatus.js';

describe('orderStatus', () => {
  it('allows only the declared transitions', () => {
    expect(ORDER_TRANSITIONS).toEqual({
      SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
      APPROVED: ['INVOICED', 'CANCELLED'],
      REJECTED: [],
      INVOICED: ['DISPATCHED', 'CANCELLED'],
      DISPATCHED: ['CANCELLED'],
      CANCELLED: []
    });

    expect(canTransition('SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'INVOICED')).toBe(true);
    expect(canTransition('INVOICED', 'CANCELLED')).toBe(true);
    expect(canTransition('DISPATCHED', 'CANCELLED')).toBe(true);
    expect(canTransition('SUBMITTED', 'INVOICED')).toBe(false);
    expect(canTransition('REJECTED', 'CANCELLED')).toBe(false);
    expect(canTransition('CANCELLED', 'SUBMITTED')).toBe(false);
    expect(canTransition('UNKNOWN', 'APPROVED')).toBe(false);
  });
});
