import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { createMockAdapter, mockNetworkError } from '../test/mockAdapter.js';
import { enqueue } from '../lib/orderQueue.js';
import { useOrderQueue } from './useOrderQueue.js';

function QueueState() {
  const queue = useOrderQueue();
  return <p data-testid="pending-count">{queue.pendingCount}</p>;
}

function installNetworkFailureMock() {
  const adapter = createMockAdapter({
    'POST /orders': () => mockNetworkError()
  });
  api.defaults.adapter = adapter;
  return adapter;
}

function seedPendingOrder() {
  enqueue({
    clientRef: 'ref-hook-001',
    customerId: 1,
    customerName: 'Retailer A',
    lines: [{ itemId: 10, name: 'Murukku', qty: 5 }]
  }, localStorage, new Date('2026-11-26T12:00:00.000Z'));
}

describe('useOrderQueue', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-11-26T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes on mount, retries every 30 seconds while pending, and cleans up its timer', async () => {
    seedPendingOrder();
    const adapter = installNetworkFailureMock();
    const view = render(<QueueState />);
    await waitFor(() => expect(adapter.calls).toHaveLength(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    await waitFor(() => expect(adapter.calls).toHaveLength(2));
    view.unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(adapter.calls).toHaveLength(2);
  });

  it('flushes pending orders when the browser comes online', async () => {
    seedPendingOrder();
    const adapter = installNetworkFailureMock();
    render(<QueueState />);
    await waitFor(() => expect(adapter.calls).toHaveLength(1));

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(adapter.calls).toHaveLength(2));
    expect(screen.getByTestId('pending-count')).toHaveTextContent('1');
  });
});
