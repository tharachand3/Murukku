export function IconButton({ label, children, className = '', ...props }) {
  return <button aria-label={label} className={`inline-flex h-10 w-10 items-center justify-center rounded-control text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-600 ${className}`} type="button" {...props}>{children}</button>;
}
