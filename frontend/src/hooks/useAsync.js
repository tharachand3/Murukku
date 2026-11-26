import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from '../lib/apiError.js';

export function useAsync(fn, deps = [], { immediate = true } = {}) {
  const [state, setState] = useState({
    data: null,
    error: null,
    loading: immediate,
    refreshing: false
  });
  const [reloadIndex, setReloadIndex] = useState(0);
  const sequence = useRef(0);
  const silentReloadRef = useRef(false);

  const reload = useCallback(({ silent = false } = {}) => {
    silentReloadRef.current = silent;
    setReloadIndex((index) => index + 1);
  }, []);

  useEffect(() => {
    if (!immediate) {
      silentReloadRef.current = false;
      setState((current) => ({ ...current, loading: false, refreshing: false }));
      return undefined;
    }
    const silent = silentReloadRef.current;
    silentReloadRef.current = false;
    const requestId = ++sequence.current;
    let active = true;
    setState((current) => ({
      ...current,
      error: null,
      loading: !silent,
      refreshing: silent
    }));

    Promise.resolve()
      .then(fn)
      .then((data) => {
        if (active && sequence.current === requestId) {
          setState({ data, error: null, loading: false, refreshing: false });
        }
      })
      .catch((error) => {
        if (active && sequence.current === requestId) {
          setState((current) => ({
            ...current,
            error: toApiError(error),
            loading: false,
            refreshing: false
          }));
        }
      });

    return () => {
      active = false;
    };
  // `deps` is intentionally supplied by callers as the request's dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate, reloadIndex, ...deps]);

  const setData = useCallback((data) => {
    setState((current) => ({
      ...current,
      data: typeof data === 'function' ? data(current.data) : data
    }));
  }, []);

  return { ...state, reload, setData };
}
