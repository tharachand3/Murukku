import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function Drawer({ open, title, onClose, children, footer }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    panelRef.current?.focus();
    const onKeyDown = (event) => { if (event.key === 'Escape') closeRef.current?.(); };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 animate-fade-in" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current?.(); }}>
    <section aria-label={title} aria-modal="true" className="flex h-full w-full max-w-lg flex-col bg-white shadow-modal animate-slide-up" ref={panelRef} role="dialog" tabIndex={-1}>
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-semibold">{title}</h2><button aria-label="Close panel" className="rounded-control p-2 hover:bg-slate-100" onClick={() => closeRef.current?.()} type="button"><X size={20} /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      {footer && <footer className="border-t border-slate-200 p-5">{footer}</footer>}
    </section>
  </div>;
}
