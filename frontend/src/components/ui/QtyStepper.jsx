import { useEffect, useRef, useState } from 'react';
import { Button } from './Button.jsx';

function clamp(value, min, max) {
  return Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min ?? 0, value));
}

// Integer-only quantity control with bounded 44px touch targets.
export function QtyStepper({ value, onChange, min = 0, max = Number.MAX_SAFE_INTEGER, label = 'Quantity' }) {
  const [draft, setDraft] = useState(String(value));
  const pendingDraftValue = useRef(null);

  useEffect(() => {
    if (pendingDraftValue.current === value) {
      pendingDraftValue.current = null;
      return;
    }
    pendingDraftValue.current = null;
    setDraft(String(value));
  }, [value]);

  const commit = (nextValue) => {
    const bounded = clamp(nextValue, min, max);
    setDraft(String(bounded));
    onChange(bounded);
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        aria-label={`Decrease ${label}`}
        className="h-11 w-11 p-0"
        disabled={value <= min}
        minHeight44
        onClick={() => commit(value - 1)}
        type="button"
        variant="secondary"
      >
        −
      </Button>
      <input
        aria-label={label}
        className="h-11 w-20 rounded-lg border border-slate-300 text-center"
        inputMode="numeric"
        max={max}
        min={min}
        onBlur={() => {
          pendingDraftValue.current = null;
          setDraft(String(value));
        }}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (/^\d+$/.test(next) && Number.isSafeInteger(Number(next))) {
            const bounded = clamp(Number(next), min, max);
            if (bounded !== value) {
              pendingDraftValue.current = bounded;
            }
            onChange(bounded);
          }
        }}
        type="text"
        value={draft}
      />
      <Button
        aria-label={`Increase ${label}`}
        className="h-11 w-11 p-0"
        disabled={value >= max}
        minHeight44
        onClick={() => commit(value + 1)}
        type="button"
        variant="secondary"
      >
        +
      </Button>
    </div>
  );
}
