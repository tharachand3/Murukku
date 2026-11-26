import { useEffect, useRef } from 'react';

// Focus-managed dialog that closes on Escape or backdrop unless persistent.
export function Modal({ open, title, onClose, persistent = false, children }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const persistentRef = useRef(persistent);
  onCloseRef.current = onClose;
  persistentRef.current = persistent;

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !persistentRef.current) {
        onCloseRef.current?.();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus?.();
    };
  }, [open]);

  if (!open) {
    return null;
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !persistentRef.current) {
          onCloseRef.current?.();
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
