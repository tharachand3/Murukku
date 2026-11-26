// Quiet placeholder for a successful request with no records.
export function EmptyState({ title = 'Nothing here yet', message, action }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <h2 className="font-semibold text-slate-800">{title}</h2>
      {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
