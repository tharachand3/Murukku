import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { toApiError } from '../lib/apiError.js';
import { flush as flushOrderQueue, list } from '../lib/orderQueue.js';

export function useOrderQueue() {
  const [items, setItems] = useState(() => list());
  const [flushing, setFlushing] = useState(false);
  const [error, setError] = useState(null);
  const mounted = useRef(false);

  const refresh = useCallback(() => {
    const nextItems = list();
    if (mounted.current) setItems(nextItems);
    return nextItems;
  }, []);

  const flush = useCallback(async () => {
    setFlushing(true);
    setError(null);
    try {
      const result = await flushOrderQueue(api);
      refresh();
      return result;
    } catch (requestError) {
      setError(toApiError(requestError));
      refresh();
      throw requestError;
    } finally {
      setFlushing(false);
    }
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const flushSilently = () => {
      flush().catch(() => {});
    };
    flushSilently();
    window.addEventListener('online', flushSilently);
    return () => {
      mounted.current = false;
      window.removeEventListener('online', flushSilently);
    };
  }, [flush, refresh]);

  const hasPending = items.some((item) => item.state === 'PENDING');
  useEffect(() => {
    if (!hasPending) return undefined;
    const timer = window.setInterval(() => {
      if (list().some((item) => item.state === 'PENDING')) {
        flush().catch(() => {});
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [flush, hasPending]);

  return {
    items,
    pendingCount: items.filter((item) => item.state === 'PENDING' || item.state === 'SENDING').length,
    failedCount: items.filter((item) => item.state === 'FAILED').length,
    flushing,
    flush,
    refresh,
    error
  };
}
