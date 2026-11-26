import { Spinner } from './Spinner.jsx';

// Consistent action button with pending and touch-target states.
export function Button({
  variant = 'primary',
  loading = false,
  minHeight44 = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...props
}) {
  const variants = {
    primary: 'bg-blue-700 text-white hover:bg-blue-800',
    secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
    danger: 'bg-red-700 text-white hover:bg-red-800',
    ghost: 'text-slate-700 hover:bg-slate-100'
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
        variants[variant] ?? variants.primary
      } ${minHeight44 ? 'min-h-11' : ''} ${className}`}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {loading && <Spinner label="Working" small />}
      {children}
    </button>
  );
}
