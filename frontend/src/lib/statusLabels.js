export const STATUS_LABELS = Object.freeze({
  SUBMITTED: 'Submitted', APPROVED: 'Approved', REJECTED: 'Rejected', INVOICED: 'Invoiced',
  DISPATCHED: 'Dispatched', CANCELLED: 'Cancelled', POSTED: 'Posted', ISSUED: 'Issued',
  COMPLETED: 'Completed', PAID: 'Paid', PARTIAL: 'Partially paid', UNPAID: 'Unpaid', FLAGGED: 'Flagged'
});

export const STATUS_TONES = Object.freeze({
  SUBMITTED: 'info', APPROVED: 'success', REJECTED: 'danger', INVOICED: 'info',
  DISPATCHED: 'success', CANCELLED: 'neutral', POSTED: 'success', ISSUED: 'info',
  COMPLETED: 'success', PAID: 'success', PARTIAL: 'warning', UNPAID: 'danger', FLAGGED: 'danger'
});
