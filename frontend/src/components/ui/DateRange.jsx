import { rangePreset } from '../../lib/date.js';

// IST calendar date controls with reusable reporting presets.
export function DateRange({ from, to, onChange, now = new Date() }) {
  const presets = ['today', 'last7', 'thisMonth', 'lastMonth', 'thisFY'];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm hover:bg-slate-50"
            key={preset}
            onClick={() => onChange(rangePreset(preset, now))}
            type="button"
          >
            {preset}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          From
          <input
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
            onChange={(event) => onChange({ from: event.target.value, to })}
            type="date"
            value={from}
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          To
          <input
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
            onChange={(event) => onChange({ from, to: event.target.value })}
            type="date"
            value={to}
          />
        </label>
      </div>
    </div>
  );
}
