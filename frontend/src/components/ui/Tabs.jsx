// Accessible tablist for switching local views.
export function Tabs({ tabs, active, onChange }) {
  return (
    <div aria-label="Sections" className="flex gap-2 border-b border-slate-200" role="tablist">
      {tabs.map((tab) => (
        <button
          aria-selected={active === tab.key}
          className={`min-h-11 border-b-2 px-3 text-sm font-medium ${
            active === tab.key ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-600'
          }`}
          key={tab.key}
          onClick={() => onChange(tab.key)}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
