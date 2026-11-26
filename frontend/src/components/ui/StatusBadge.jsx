import { Badge } from './Badge.jsx';

const TONES = {
  SUBMITTED: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  INVOICED: 'bg-indigo-100 text-indigo-800',
  DISPATCHED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-200 text-slate-700',
  POSTED: 'bg-green-100 text-green-800',
  ISSUED: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  PAID: 'bg-green-100 text-green-800',
  PARTIAL: 'bg-amber-100 text-amber-800',
  UNPAID: 'bg-red-100 text-red-800',
  FLAGGED: 'bg-red-100 text-red-800'
};

// Consistent color mapping for domain workflow states.
export function StatusBadge({ status }) {
  return <Badge className={TONES[status] ?? 'bg-slate-100 text-slate-700'}>{status}</Badge>;
}
