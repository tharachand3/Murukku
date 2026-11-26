import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Info } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((tone, message) => {
    const id = ++nextId.current;
    setToasts((current) => [...current.slice(-2), { id, tone, message: String(message) }]);
    timers.current.set(id, window.setTimeout(() => {
      dismiss(id);
    }, 4000));
  }, [dismiss]);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  const value = {
    success: (message) => push('success', message),
    error: (message) => push('error', message),
    info: (message) => push('info', message)
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            className={`flex items-center gap-3 rounded-card border bg-white px-4 py-3 shadow-lg animate-slide-up ${
              toast.tone === 'error'
                ? 'border-red-300 text-red-800'
                : toast.tone === 'success'
                  ? 'border-green-300 text-green-800'
                  : 'border-slate-300 text-slate-800'
            }`}
            key={toast.id}
            role="status"
          >
            {toast.tone === 'error' ? <CircleAlert aria-hidden="true" size={18} /> : toast.tone === 'success' ? <CheckCircle2 aria-hidden="true" size={18} /> : <Info aria-hidden="true" size={18} />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
