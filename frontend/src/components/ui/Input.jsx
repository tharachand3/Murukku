import { useId } from 'react';
import { Field } from './Field.jsx';

// Accessible labeled text input.
export function Input({ id: suppliedId, label, hint, error, required, className = '', leftIcon, rightIcon, prefix, suffix, ...props }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <div className="relative flex items-center">
        {leftIcon && <span aria-hidden="true" className="pointer-events-none absolute left-3 text-slate-500">{leftIcon}</span>}
        {prefix && <span aria-hidden="true" className="absolute left-3 text-sm text-slate-500">{prefix}</span>}
        <input {...props} aria-describedby={describedBy} aria-invalid={Boolean(error)}
          className={`min-h-12 w-full rounded-control border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 sm:min-h-10 ${error ? 'border-red-600' : 'border-slate-300'} ${leftIcon || prefix ? 'pl-10' : ''} ${rightIcon || suffix ? 'pr-10' : ''} ${className}`}
          id={id} required={required} />
        {rightIcon && <span aria-hidden="true" className="absolute right-3 text-slate-500">{rightIcon}</span>}
        {suffix && <span aria-hidden="true" className="absolute right-3 text-sm text-slate-500">{suffix}</span>}
      </div>
    </Field>
  );
}
