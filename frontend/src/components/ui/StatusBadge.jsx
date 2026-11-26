import { Badge } from './Badge.jsx';
import { STATUS_LABELS, STATUS_TONES } from '../../lib/statusLabels.js';

// Consistent color mapping for domain workflow states.
export function StatusBadge({ status }) {
  const tone = STATUS_TONES[status] ?? 'neutral';
  const dots = { success: 'bg-green-600', warning: 'bg-amber-500', danger: 'bg-red-600', info: 'bg-sky-600', neutral: 'bg-slate-500' };
  return <Badge className="gap-1.5" title={status} tone={tone}><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} />{STATUS_LABELS[status] ?? status}</Badge>;
}
