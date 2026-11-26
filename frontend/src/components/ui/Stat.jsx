// Compact metric display with optional context and tone.
export function Stat({ label, value, sub, tone = 'default' }) {
  const tones = {
    default: 'text-slate-900',
    positive: 'text-green-700',
    warning: 'text-amber-700',
    negative: 'text-red-700'
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tones[tone] ?? tones.default}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
