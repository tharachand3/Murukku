// Page title row with optional supporting text and actions.
export function PageHeader({ title, subtitle, description = subtitle, actions, breadcrumbs }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        {breadcrumbs}
        <h1 className="text-2xl font-semibold leading-8 text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm leading-5 text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
