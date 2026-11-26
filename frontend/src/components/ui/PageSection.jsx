export function PageSection({ title, description, children, className = '' }) {
  return <section className={`mb-6 ${className}`}>{(title || description) && <header className="mb-3"><h2 className="text-lg font-semibold leading-7 text-slate-900">{title}</h2>{description && <p className="mt-1 text-sm text-slate-600">{description}</p>}</header>}{children}</section>;
}
