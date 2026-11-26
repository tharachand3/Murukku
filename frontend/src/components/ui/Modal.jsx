import { useEffect, useRef } from 'react';

// Focus-managed dialog that closes on Escape or backdrop unless persistent.
export function Modal({ open, title, onClose, persistent = false, children }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !persistent) {
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus?.();
    };
  }, [open, onClose, persistent]);

  if (!open) {
    return null;
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !persistent) {
          onClose?.();
        }
      }}
    >
      <section
        aria-label={title}
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-2xl"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {title && <h2 className="mb-4 text-lg font-bold text-slate-900">{title}</h2>}
        {children}
      </section>
    </div>
  );
}
