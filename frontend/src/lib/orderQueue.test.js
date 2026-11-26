import axios from 'axios';
import { describe, expect, it } from 'vitest';
import { createMockAdapter, mockNetworkError } from '../test/mockAdapter.js';
import { createClientRef, discardFailed, enqueue, flush, list, remove } from './orderQueue.js';

function makeStorage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = String(next); },
    removeItem: () => { value = null; }
  };
}

function makeOrder(clientRef = createClientRef(), customerId = 1) {
  return {
    clientRef,
    customerId,
    customerName: `Customer ${customerId}`,
    lines: [{ itemId: 10, name: 'Murukku', qty: 150 }],
    notes: 'Deliver in the morning'
  };
}

function makeApi(routes) {
  const instance = axios.create();
  instance.defaults.adapter = createMockAdapter(routes);
  return instance;
}

const fixedNow = new Date('2026-11-26T12:00:00.000Z');

describe('offline order queue', () => {
  it('persists new orders with a backend-compatible clientRef and ISO date', () => {
    const storage = makeStorage();
    const item = enqueue(makeOrder(), storage, fixedNow);

    expect(item.clientRef).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(item.createdAt).toBe('2026-11-26T12:00:00.000Z');
    expect(item.state).toBe('PENDING');
    expect(item.attempts).toBe(0);
    expect(list(storage)).toEqual([item]);
    expect(JSON.parse(storage.getItem('oda.orderQueue'))).toEqual([item]);
  });

  it('removes an order after a successful send', async () => {
    const storage = makeStorage();
    enqueue(makeOrder('ref-success-1'), storage, fixedNow);
    const api = makeApi({ 'POST /orders': { status: 201, data: { order: { orderNo: 'ORD/2026-27/0001' } } } });

    await expect(flush(api, storage)).resolves.toEqual({ sent: 1, failed: 0, remaining: 0 });
    expect(list(storage)).toEqual([]);
  });

  it('keeps a network-failed order pending and stops the batch', async () => {
    const storage = makeStorage();
    enqueue(makeOrder('ref-network-1'), storage, fixedNow);
    enqueue(makeOrder('ref-network-2', 2), storage, fixedNow);
    const api = makeApi({ 'POST /orders': () => mockNetworkError() });

    await expect(flush(api, storage)).resolves.toEqual({ sent: 0, failed: 0, remaining: 2 });
    expect(list(storage).map((item) => item.state)).toEqual(['PENDING', 'PENDING']);
    expect(list(storage)[0].attempts).toBe(1);
  });

  it('marks a 422 order failed and continues sending later orders', async () => {
    const storage = makeStorage();
    enqueue(makeOrder('ref-invalid-1'), storage, fixedNow);
    enqueue(makeOrder('ref-valid-2', 2), storage, fixedNow);
    const api = makeApi({
      'POST /orders': (config) => {
        const body = JSON.parse(config.data);
        return body.customerId === 1
          ? {
              status: 422,
              data: { error: { code: 'NO_PRICE', message: 'No price for this customer' } }
            }
          : { status: 201, data: { order: { orderNo: 'ORD/2026-27/0002' } } };
      }
    });

    await expect(flush(api, storage)).resolves.toEqual({ sent: 1, failed: 1, remaining: 1 });
    expect(list(storage)).toMatchObject([
      { clientRef: 'ref-invalid-1', state: 'FAILED', lastError: 'No price for this customer' }
    ]);
  });

  it('removes a duplicate clientRef response as already sent', async () => {
    const storage = makeStorage();
    enqueue(makeOrder('ref-duplicate-1'), storage, fixedNow);
    const api = makeApi({
      'POST /orders': { status: 200, data: { duplicate: true, order: { orderNo: 'ORD/2026-27/0003' } } }
    });

    await expect(flush(api, storage)).resolves.toEqual({ sent: 1, failed: 0, remaining: 0 });
    expect(list(storage)).toEqual([]);
  });

  it('reuses the same clientRef when an order is retried', async () => {
    const storage = makeStorage();
    enqueue(makeOrder('ref-retry-123'), storage, fixedNow);
    const firstApi = makeApi({ 'POST /orders': () => mockNetworkError() });
    await flush(firstApi, storage);
    const secondApi = makeApi({
      'POST /orders': { status: 201, data: { order: { orderNo: 'ORD/2026-27/0004' } } }
    });
    await flush(secondApi, storage);

    expect(secondApi.defaults.adapter.calls[0].data.clientRef).toBe('ref-retry-123');
    expect(list(storage)).toEqual([]);
  });

  it('shares one in-flight request between concurrent flush calls', async () => {
    const storage = makeStorage();
    enqueue(makeOrder('ref-parallel-1'), storage, fixedNow);
    let finish;
    const api = makeApi({
      'POST /orders': () => new Promise((resolve) => {
        finish = () => resolve({ status: 201, data: { order: { orderNo: 'ORD/2026-27/0005' } } });
      })
    });

    const first = flush(api, storage);
    const second = flush(api, storage);
    expect(second).toBe(first);
    expect(api.defaults.adapter.calls).toHaveLength(1);
    finish();
    await expect(first).resolves.toEqual({ sent: 1, failed: 0, remaining: 0 });
  });

  it('resets stale SENDING entries on storage load and treats corrupt data as empty', () => {
    const stale = makeStorage(JSON.stringify([{ ...makeOrder('ref-stale-123'), createdAt: fixedNow.toISOString(),
      state: 'SENDING', attempts: 1, lastError: null }]));
    expect(list(stale)[0].state).toBe('PENDING');
    expect(JSON.parse(stale.getItem('oda.orderQueue'))[0].state).toBe('PENDING');

    const corrupt = makeStorage('{not json');
    expect(list(corrupt)).toEqual([]);
    expect(corrupt.getItem('oda.orderQueue')).toBe('[]');
  });

  it('only discards failed entries and supports direct removal', () => {
    const storage = makeStorage();
    const pending = enqueue(makeOrder('ref-pending-1'), storage, fixedNow);
    enqueue(makeOrder('ref-failed-1', 2), storage, fixedNow);
    const stored = list(storage);
    storage.setItem('oda.orderQueue', JSON.stringify([
      stored[0],
      { ...stored[1], state: 'FAILED', lastError: 'Invalid order' }
    ]));

    expect(discardFailed(pending.clientRef, storage)).toBe(false);
    expect(discardFailed('ref-failed-1', storage)).toBe(true);
    expect(remove(pending.clientRef, storage)).toBe(true);
    expect(list(storage)).toEqual([]);
  });
});
