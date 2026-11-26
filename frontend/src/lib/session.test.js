import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession } from './session.js';

describe('session storage', () => {
  beforeEach(() => clearSession());

  it('round-trips an authenticated session and clears it', () => {
    const session = { token: 'token-1', user: { id: 1, role: 'ADMIN' } };
    saveSession(session);
    expect(loadSession()).toEqual(session);
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it('removes corrupt or incomplete session JSON safely', () => {
    localStorage.setItem('oda.session', '{broken');
    expect(loadSession()).toBeNull();
    expect(localStorage.getItem('oda.session')).toBeNull();
    localStorage.setItem('oda.session', JSON.stringify({ token: 'only-token' }));
    expect(loadSession()).toBeNull();
  });
});
