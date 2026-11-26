import { useId } from 'react';
import { Field } from './Field.jsx';

// Accessible labeled select input.
export function Select({ id: suppliedId, label, hint, error, required, className = '', children, ...props }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <select
        {...props}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        className={`min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 ${className}`}
        id={id}
        required={required}
      >
        {children}
      </select>
    </Field>
  );
}
