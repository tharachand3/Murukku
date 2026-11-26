import { useId } from 'react';
import { Field } from './Field.jsx';

// Accessible labeled multi-line input.
export function Textarea({ id: suppliedId, label, hint, error, required, className = '', ...props }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <textarea
        {...props}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        className={`min-h-24 w-full rounded-control border bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 ${error ? 'border-red-600' : 'border-slate-300'} ${className}`}
        id={id}
        required={required}
      />
    </Field>
  );
}
