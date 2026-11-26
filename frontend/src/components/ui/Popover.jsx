import { useEffect, useRef } from 'react';

export function Popover({ open, onClose, trigger, children, className = '' }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') onCloseRef.current?.(); };
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);
  return <div className="relative">{trigger}{open && <div className={`absolute right-0 top-full z-50 mt-2 min-w-56 rounded-card border border-slate-200 bg-white p-2 shadow-lg animate-fade-in ${className}`} ref={panelRef} role="dialog" tabIndex={-1}>{children}</div>}</div>;
}
