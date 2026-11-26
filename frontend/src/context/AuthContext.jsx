import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { installApiInterceptors } from '../lib/apiSetup.js';
import { toApiError } from '../lib/apiError.js';
import { clearSession, loadSession, saveSession } from '../lib/session.js';

const AuthContext = createContext(null);
const EXPIRED_NOTICE = 'Your session expired. Please sign in again.';

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState({
    user: null,
    token: null,
    status: 'loading',
    notice: null
  });
  const tokenRef = useRef(null);

  useEffect(() => {
    let active = true;
    const stored = loadSession();
    tokenRef.current = stored?.token ?? null;

    installApiInterceptors(api, {
      getToken: () => tokenRef.current,
      onUnauthorized: () => {
        clearSession();
        tokenRef.current = null;
        if (active) {
          setAuth({
            user: null,
            token: null,
            status: 'anonymous',
            notice: EXPIRED_NOTICE
          });
        }
      }
    });

    if (!stored) {
      setAuth({ user: null, token: null, status: 'anonymous', notice: null });
      return () => {
        active = false;
      };
    }

    api.get('/auth/me')
      .then(({ data }) => {
        if (active) {
          setAuth({
            user: data.user,
            token: stored.token,
            status: 'authenticated',
            notice: null
          });
        }
      })
      .catch((error) => {
        if (error?.response?.status === 401) {
          clearSession();
          tokenRef.current = null;
          if (active) {
            setAuth((current) => ({
              ...current,
              user: null,
              token: null,
              status: 'anonymous',
              notice: toApiError(error).message
            }));
          }
          return;
        }
        tokenRef.current = null;
        if (active) {
          setAuth((current) => ({
            ...current,
            user: null,
            token: null,
            status: 'anonymous'
          }));
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    saveSession(data);
    tokenRef.current = data.token;
    setAuth({
      user: data.user,
      token: data.token,
      status: 'authenticated',
      notice: null
    });
    return data.user;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    tokenRef.current = null;
    setAuth({ user: null, token: null, status: 'anonymous', notice: null });
  }, []);

  return (
    <AuthContext.Provider value={{ ...auth, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
