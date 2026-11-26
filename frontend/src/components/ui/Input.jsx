import { useId } from 'react';
import { Field } from './Field.jsx';

// Accessible labeled text input.
export function Input({ id: suppliedId, label, hint, error, required, className = '', ...props }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <input
        {...props}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        className={`min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 ${className}`}
        id={id}
        required={required}
      />
    </Field>
  );
}
