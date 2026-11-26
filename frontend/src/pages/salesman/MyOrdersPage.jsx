import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QueuePanel } from '../../components/salesman/QueuePanel.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { useOrderQueue } from '../../hooks/useOrderQueue.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { toApiError } from '../../lib/apiError.js';
import { formatDateTimeIST, rangePreset, todayIST } from '../../lib/date.js';
import { formatPaise } from '../../lib/money.js';

const STATUS_FILTERS = [
  ['All', null],
  ['Submitted', 'SUBMITTED'],
  ['Approved', 'APPROVED'],
  ['Invoiced', 'INVOICED'],
  ['Dispatched', 'DISPATCHED'],
  ['Rejected', 'REJECTED'],
  ['Cancelled', 'CANCELLED']
];

function filterRange(preset, now) {
  if (preset === 'all') return { from: '', to: '' };
  if (preset === 'today') {
    const today = todayIST(now);
    return { from: today, to: today };
  }
  return rangePreset('thisMonth', now);
}

export default function MyOrdersPage({ now = new Date() }) {
  const queue = useOrderQueue();
  const [status, setStatus] = useState(null);
  const [datePreset, setDatePreset] = useState('all');
  const [range, setRange] = useState({ from: '', to: '' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);
  const queryKey = `${status ?? 'all'}|${range.from}|${range.to}`;

  const loadOrders = useCallback(async () => {
    const params = { page: 1, limit: 20 };
    if (status) params.status = status;
    if (range.from) params.from = range.from;
    if (range.to) params.to = range.to;
    const { data } = await api.get('/orders', { params });
    if (!Array.isArray(data?.items)) {
      throw new TypeError('The server returned an invalid order list');
    }
    return { ...data, key: queryKey };
  }, [queryKey, range.from, range.to, status]);
  const ordersRequest = useAsync(loadOrders, [queryKey]);
  const orders = ordersRequest.data?.key === queryKey ? ordersRequest.data : null;

  useEffect(() => {
    setMoreError(null);
  }, [queryKey]);

  const refresh = ordersRequest.reload;
  useEffect(() => {
    let timer = null;
    const syncVisibilityTimer = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      if (document.visibilityState === 'visible') {
        timer = window.setInterval(() => {
          if (document.visibilityState === 'visible') refresh();
        }, 60000);
      }
    };
    syncVisibilityTimer();
    document.addEventListener('visibilitychange', syncVisibilityTimer);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', syncVisibilityTimer);
    };
  }, [refresh]);

  const setDateFilter = (preset) => {
    setDatePreset(preset);
    setRange(filterRange(preset, now));
  };

  const loadMore = async () => {
    if (!orders || loadingMore) return;
    const page = orders.page + 1;
    const params = { page, limit: orders.limit };
    if (status) params.status = status;
    if (range.from) params.from = range.from;
    if (range.to) params.to = range.to;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const { data } = await api.get('/orders', { params });
      if (!Array.isArray(data?.items)) {
        throw new TypeError('The server returned an invalid order list');
      }
      if (queryKey !== `${status ?? 'all'}|${range.from}|${range.to}`) return;
      ordersRequest.setData((current) => (
        current?.key === queryKey
          ? {
              ...current,
              ...data,
              key: queryKey,
              items: [...current.items, ...data.items]
            }
          : current
      ));
    } catch (error) {
      setMoreError(toApiError(error));
    } finally {
      setLoadingMore(false);
    }
  };

  const isFiltering = ordersRequest.loading || loadingMore;
  const hasMore = Boolean(orders && orders.page * orders.limit < orders.total);

  return (
    <div className="mx-auto max-w-4xl pb-24">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My orders</h1>
          <p className="mt-1 text-sm text-slate-600">Track your submitted customer orders.</p>
        </div>
        <Button
          disabled={ordersRequest.loading}
          loading={ordersRequest.loading}
          onClick={refresh}
          variant="secondary"
        >
          Refresh
        </Button>
      </header>

      {queue.items.length > 0 && <div className="mb-5"><QueuePanel queue={queue} /></div>}

      <section aria-label="Order filters" className="mb-5 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div aria-label="Filter by status" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(([label, value]) => (
            <button
              aria-pressed={status === value}
              className={`min-h-11 rounded-full border px-3 text-sm font-medium ${
                status === value
                  ? 'border-blue-700 bg-blue-50 text-blue-900'
                  : 'border-slate-300 text-slate-700'
              }`}
              disabled={isFiltering}
              key={label}
              onClick={() => setStatus(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div aria-label="Filter by date" className="flex flex-wrap gap-2">
          {[
            ['Today', 'today'],
            ['This month', 'thisMonth'],
            ['All', 'all']
          ].map(([label, value]) => (
            <button
              aria-pressed={datePreset === value}
              className={`min-h-11 rounded-lg border px-3 text-sm ${
                datePreset === value ? 'border-blue-700 text-blue-900' : 'border-slate-300 text-slate-700'
              }`}
              disabled={isFiltering}
              key={value}
              onClick={() => setDateFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {ordersRequest.loading && (
        <p className="mb-4 text-sm text-slate-600" role="status">Loading orders…</p>
      )}
      {ordersRequest.error && (
        <ErrorBox
          message={ordersRequest.error.message}
          onRetry={refresh}
          loading={ordersRequest.loading}
        />
      )}
      {moreError && (
        <div className="mb-4">
          <ErrorBox
            message={moreError.message}
            onRetry={loadMore}
            loading={loadingMore}
          />
        </div>
      )}

      {!ordersRequest.loading && !ordersRequest.error && orders && orders.items.length === 0 && (
        <EmptyState
          action={
            <Link
              className="inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 font-medium text-white"
              to="/new-order"
            >
              Create an order
            </Link>
          }
          message="Create a new order for one of your assigned customers."
          title="No orders yet"
        />
      )}

      {orders && orders.items.length > 0 && (
        <div className="space-y-3">
          {orders.items.map((order) => (
            <Link
              className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300"
              key={order.id}
              to={`/my-orders/${order.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-blue-900">{order.orderNo}</h2>
                  <p className="mt-1 text-slate-800">{order.customerName}</p>
                  <p className="mt-1 text-sm text-slate-500">{formatDateTimeIST(order.createdAt)}</p>
                </div>
                <StatusBadge status={order.status} />
              </div>
              <div className="mt-3 flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-3 text-sm">
                <span>{order.totalQty} packets</span>
                <span className="font-medium">{formatPaise(order.taxableTotalPaise)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {hasMore && (
        <div className="mt-5 text-center">
          <Button disabled={loadingMore || ordersRequest.loading} loading={loadingMore} onClick={loadMore} variant="secondary">
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
