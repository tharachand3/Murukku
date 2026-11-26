export function Skeleton({ variant = 'text', className = '', rows = 3 }) {
  if (variant === 'card') return <div aria-label="Loading content" className={`rounded-card border border-slate-200 bg-white p-5 ${className}`} role="status"><div className="skeleton-shimmer mb-4 h-4 w-2/5 rounded" /><div className="skeleton-shimmer h-8 w-1/3 rounded" /><div className="skeleton-shimmer mt-4 h-3 w-3/4 rounded" /></div>;
  if (variant === 'table') return <div aria-label="Loading table" className={`space-y-2 ${className}`} role="status">{Array.from({ length: rows }, (_, index) => <div className="skeleton-shimmer h-10 rounded" key={index} />)}</div>;
  return <span aria-label="Loading" className={`skeleton-shimmer inline-block h-4 w-32 rounded ${className}`} role="status" />;
}
