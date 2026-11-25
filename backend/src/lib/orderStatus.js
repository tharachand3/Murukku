export const ORDER_TRANSITIONS = Object.freeze({
  SUBMITTED: Object.freeze(['APPROVED', 'REJECTED', 'CANCELLED']),
  APPROVED: Object.freeze(['INVOICED', 'CANCELLED']),
  REJECTED: Object.freeze([]),
  INVOICED: Object.freeze(['DISPATCHED', 'CANCELLED']),
  DISPATCHED: Object.freeze(['CANCELLED']),
  CANCELLED: Object.freeze([])
});

// INVOICED/DISPATCHED cancellation is reserved for the credit-note flow (step 31).
export function canTransition(from, to) {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}
