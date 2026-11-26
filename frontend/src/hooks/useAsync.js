import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from '../lib/apiError.js';

export function useAsync(fn, deps = [], { immediate = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: immediate });
  const [reloadIndex, setReloadIndex] = useState(0);
  const sequence = useRef(0);

  const reload = useCallback(() => {
    setReloadIndex((index) => index + 1);
  }, []);

  useEffect(() => {
    if (!immediate) {
      setState((current) => ({ ...current, loading: false }));
      return undefined;
    }
    const requestId = ++sequence.current;
    let active = true;
    setState((current) => ({ ...current, error: null, loading: true }));

    Promise.resolve()
      .then(fn)
      .then((data) => {
        if (active && sequence.current === requestId) {
          setState({ data, error: null, loading: false });
        }
      })
      .catch((error) => {
        if (active && sequence.current === requestId) {
          setState((current) => ({
            ...current,
            error: toApiError(error),
            loading: false
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
