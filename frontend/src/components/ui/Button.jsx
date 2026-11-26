import { Spinner } from './Spinner.jsx';

// Consistent action button with pending and touch-target states.
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  minHeight44 = false,
  leftIcon,
  rightIcon,
  className = '',
  children,
  disabled,
  type = 'button',
  ...props
}) {
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-600',
    accent: 'bg-turmeric-500 text-slate-950 hover:bg-turmeric-600 focus-visible:ring-turmeric-600',
    secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
    danger: 'bg-red-700 text-white hover:bg-red-800',
    ghost: 'text-slate-700 hover:bg-slate-100',
    link: 'text-brand-700 underline-offset-4 hover:underline'
  };
  const sizes = { sm: 'min-h-9 px-3 text-sm', md: 'min-h-10 px-4 text-sm', lg: 'min-h-12 px-5 text-base' };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-control font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 transition-all active:scale-[.98] ${
        variants[variant] ?? variants.primary
      } ${sizes[size] ?? sizes.md} ${minHeight44 ? 'min-h-11' : ''} ${className}`}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {loading && <Spinner label="Working" small />}
      {!loading && leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}
