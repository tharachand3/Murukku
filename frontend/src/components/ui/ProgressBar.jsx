export function ProgressBar({ value, max = 100, label = 'Progress' }) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return <div aria-label={label} aria-valuemax={max} aria-valuemin={0} aria-valuenow={value} className="h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} /></div>;
}
