import { useId } from 'react';
import { Field } from './Field.jsx';

// Filterable native list control suitable for customer phone selection.
export function SearchSelect({ id: suppliedId, label, value, options, onChange, hint, error }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const listId = `${id}-options`;
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input
        aria-autocomplete="list"
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        aria-invalid={Boolean(error)}
        className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2"
        id={id}
        list={listId}
        onChange={onChange}
        value={value}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </datalist>
    </Field>
  );
}
