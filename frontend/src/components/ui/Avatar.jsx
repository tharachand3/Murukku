export function Avatar({ name = '', className = '', ...props }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
  return <span aria-label={name || 'User'} className={`inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800 ${className}`} role="img" {...props}>{initials}</span>;
}
