import { useEffect, useRef } from 'react';

// Focus-managed dialog that closes on Escape or backdrop unless persistent.
export function Modal({ open, title, onClose, persistent = false, children, size = 'md', footer, className = '' }) {
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 animate-fade-in sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !persistentRef.current) {
          onCloseRef.current?.();
        }
      }}
    >
      <section
        aria-label={title}
        aria-modal="true"
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-card bg-white shadow-modal animate-slide-up sm:max-h-[90vh] sm:rounded-card sm:animate-scale-in ${size === 'sm' ? 'sm:max-w-md' : size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-xl'} ${className}`}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {title && <h2 className="shrink-0 border-b border-slate-100 px-5 py-4 text-lg font-semibold text-slate-900">{title}</h2>}
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <div className="sticky bottom-0 shrink-0 border-t border-slate-200 bg-white px-5 py-4">{footer}</div>}
      </section>
    </div>
  );
}
