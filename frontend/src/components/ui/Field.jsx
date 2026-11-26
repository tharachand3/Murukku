// Label and field message wrapper with explicit input association.
export function Field({ id, label, hint, error, required = false, children }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-slate-800" htmlFor={id}>
        {label}{required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="text-sm text-slate-500" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="text-sm text-red-700" id={`${id}-error`}>{error}</p>}
    </div>
  );
}
