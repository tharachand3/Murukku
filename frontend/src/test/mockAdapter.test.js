import axios from 'axios';
import { describe, expect, it } from 'vitest';
import { installMock, mockNetworkError } from './mockAdapter.js';

describe('mock axios adapter', () => {
  it('records requests and ignores query params unless a route specifies them', async () => {
    const api = axios.create({ baseURL: '/api' });
    const { calls } = installMock(api, {
      'GET /orders': { status: 200, data: { rows: [] } },
      'POST /orders': (config) => ({ status: 201, data: { received: config.data } }),
      'GET /search?term=abc': { status: 200, data: { matched: true } }
    });
    await api.get('/orders', { params: { page: 2 } });
    await api.post('/orders', { customerId: 7 });
    await api.get('/search', { params: { term: 'abc' } });
    expect(calls.map(({ method, url }) => [method, url])).toEqual([
      ['get', '/orders'],
      ['post', '/orders'],
      ['get', '/search']
    ]);
    expect(calls[0].params).toEqual({ page: 2 });
    expect(calls[1].data).toEqual({ customerId: 7 });
  });

  it('fails loudly for unmatched calls and rejects non-2xx as AxiosError', async () => {
    const api = axios.create({ baseURL: '/api' });
    installMock(api, {
      'GET /denied': { status: 403, data: { error: { message: 'Denied' } } }
    });
    await expect(api.get('/missing')).rejects.toThrow('No mock for GET /missing');
    await expect(api.get('/denied')).rejects.toMatchObject({
      isAxiosError: true,
      response: { status: 403, data: { error: { message: 'Denied' } } }
    });
  });

  it('creates a response-less Axios network error', async () => {
    await expect(mockNetworkError()).rejects.toMatchObject({
      isAxiosError: true,
      code: 'ERR_NETWORK'
    });
    await expect(mockNetworkError()).rejects.not.toHaveProperty('response');
  });
});
