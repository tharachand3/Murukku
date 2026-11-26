const SESSION_KEY = 'oda.session';

export function loadSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (typeof value?.token === 'string' && value.user && typeof value.user === 'object') {
      return { token: value.token, user: value.user };
    }
  } catch {
    clearSession();
  }
  if (localStorage.getItem(SESSION_KEY) !== null) {
    clearSession();
  }
  return null;
}

export function saveSession({ token, user }) {
  if (typeof token !== 'string' || !user || typeof user !== 'object') {
    throw new TypeError('A session requires a token and user');
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
