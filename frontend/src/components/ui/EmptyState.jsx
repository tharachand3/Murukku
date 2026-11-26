// Quiet placeholder for a successful request with no records.
export function EmptyState({ title = 'Nothing here yet', message, text, action, illustration = 'box' }) {
  const drawings = {
    box: <><path d="m3 7 9 5 9-5M12 22V12M3 7l9-5 9 5v10l-9 5-9-5z" /></>,
    document: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></>,
    chart: <><path d="M3 3v18h18M8 15v-4m5 4V6m5 9V9" /></>
  };
  return (
    <div className="rounded-card border border-dashed border-slate-300 bg-white p-8 text-center">
      <svg aria-hidden="true" className="mx-auto mb-4 h-10 w-10 text-brand-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">{drawings[illustration] ?? drawings.box}</svg>
      <h2 className="font-semibold text-slate-800">{title}</h2>
      {(text || message) && <p className="mt-2 text-sm text-slate-600">{text || message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
