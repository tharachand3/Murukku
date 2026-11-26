// Compact metric display with optional context and tone.
export function Stat({ label, value, sub, tone = 'default', icon, trend }) {
  const tones = {
    default: 'text-slate-900',
    positive: 'text-green-700',
    warning: 'text-amber-700',
    negative: 'text-red-700'
  };
  return (
    <div className="rounded-card border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between"><p className="text-sm text-slate-600">{label}</p>{icon && <span className="text-brand-600">{icon}</span>}</div>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${tones[tone] ?? tones.default}`}>{value}</p>
      {trend && <p className="mt-1 text-xs text-slate-600">{trend}</p>}
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
