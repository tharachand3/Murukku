import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { installApiInterceptors } from './apiSetup.js';
import { installMock } from '../test/mockAdapter.js';

describe('API interceptors', () => {
  it('adds the current bearer token and installs only one interceptor pair', async () => {
    const api = axios.create({ baseURL: '/api' });
    let token = 'session-token';
    const onUnauthorized = vi.fn();
    const first = installApiInterceptors(api, { getToken: () => token, onUnauthorized });
    installApiInterceptors(api, { getToken: () => token, onUnauthorized });
    expect(api.interceptors.request.handlers.filter(Boolean)).toHaveLength(1);
    expect(api.interceptors.response.handlers.filter(Boolean)).toHaveLength(1);
    const { calls } = installMock(api, { 'GET /private': { ok: true } });
    await api.get('/private');
    expect(calls[0].headers.Authorization).toBe('Bearer session-token');

    token = 'new-token';
    await api.get('/private');
    expect(calls[1].headers.Authorization).toBe('Bearer new-token');
    expect(first.requestId).toBe(0);
  });

  it('notifies once on protected 401 and never logs out on login 401', async () => {
    const api = axios.create({ baseURL: '/api' });
    const onUnauthorized = vi.fn();
    installApiInterceptors(api, { getToken: () => null, onUnauthorized });
    installMock(api, {
      'GET /auth/me': { status: 401, data: { error: { code: 'UNAUTHORIZED' } } },
      'POST /auth/login': { status: 401, data: { error: { code: 'UNAUTHORIZED' } } }
    });
    await expect(api.get('/auth/me')).rejects.toMatchObject({ response: { status: 401 } });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ response: { status: 401 } });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
