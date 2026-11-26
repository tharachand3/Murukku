import { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui/Card.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Stat } from '../../components/ui/Stat.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { formatDateTimeIST } from '../../lib/date.js';
import { formatBp, formatPaise } from '../../lib/money.js';

function isValidSummary(data) {
  return Boolean(
    data &&
    typeof data.generatedAt === 'string' &&
    typeof data.today?.date === 'string' &&
    data.today?.orders &&
    data.today?.invoices &&
    data.today?.payments &&
    data.today?.dispatches &&
    data.pendingApproval &&
    Array.isArray(data.stock?.finished) &&
    Array.isArray(data.stock?.raw) &&
    Array.isArray(data.stock?.packaging) &&
    Array.isArray(data.stock?.low) &&
    Number.isSafeInteger(data.shortages?.totalShortPackets) &&
    Array.isArray(data.shortages?.items) &&
    Number.isSafeInteger(data.variance?.last30Days?.completedRuns) &&
    Number.isSafeInteger(data.variance?.last30Days?.flaggedRuns) &&
    Array.isArray(data.variance?.recentAlerts) &&
    data.costing &&
    Number.isSafeInteger(data.receivables?.outstandingPaise) &&
    Number.isSafeInteger(data.receivables?.over90Paise) &&
    Array.isArray(data.receivables?.topCustomers)
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard">
      <span className="sr-only">Loading dashboard</span>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="h-28 animate-pulse rounded-xl bg-slate-200" key={index} />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="h-56 animate-pulse rounded-xl bg-slate-200" key={index} />
        ))}
      </div>
    </div>
  );
}

function Panel({ title, children, className = '' }) {
  return (
    <Card className={className}>
      <h2 className="mb-4 text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </Card>
  );
}

function StockRows({ label, items, lowIds }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{label}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"
            data-stock-item
            key={item.itemId}
          >
            <span className="min-w-0 truncate text-sm text-slate-800">{item.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-sm font-medium tabular-nums text-slate-900">
                {item.display}
              </span>
              {lowIds.has(item.itemId) && (
                <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
                  Low
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const loadSummary = useCallback(async () => {
    const { data } = await api.get('/dashboard/summary');
    if (!isValidSummary(data)) {
      throw new TypeError('The server returned an invalid dashboard summary');
    }
    return data;
  }, []);
  const request = useAsync(loadSummary, [loadSummary]);

  useEffect(() => {
    let timer = null;
    const syncVisibilityTimer = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      if (document.visibilityState === 'visible') {
        timer = window.setInterval(() => {
          if (document.visibilityState === 'visible') {
            request.reload();
          }
        }, 60000);
      }
    };
    syncVisibilityTimer();
    document.addEventListener('visibilitychange', syncVisibilityTimer);
    return () => {
      if (timer !== null) {
        window.clearInterval(timer);
      }
      document.removeEventListener('visibilitychange', syncVisibilityTimer);
    };
  }, [request.reload]);

  const summary = request.data;
  const lowIds = new Set((summary?.stock.low ?? []).map(({ itemId }) => itemId));
  const stockCount = summary
    ? summary.stock.finished.length + summary.stock.raw.length + summary.stock.packaging.length
    : 0;
  const singleShortage = summary?.shortages.items.length === 1
    ? summary.shortages.items[0]
    : null;

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Owner dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">
            Orders, stock, production variance and receivables at a glance.
          </p>
          {summary?.generatedAt && (
            <p className="mt-1 text-xs text-slate-500">
              Last updated <time dateTime={summary.generatedAt}>{formatDateTimeIST(summary.generatedAt)}</time>
            </p>
          )}
        </div>
        <Button
          disabled={request.loading}
          loading={request.loading}
          onClick={request.reload}
          variant="secondary"
        >
          Refresh
        </Button>
      </header>

      {request.error && (
        <ErrorBox message={request.error.message} onRetry={request.reload} loading={request.loading} />
      )}
      {request.loading && !summary && <DashboardSkeleton />}
      {!request.loading && !summary && !request.error && (
        <EmptyState title="Dashboard unavailable" message="No dashboard summary is available yet." />
      )}

      {summary && (
        <>
          <section aria-label="Today's summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat
              label="Today's orders"
              value={summary.today.orders.count}
              sub={`Taxable value: ${formatPaise(summary.today.orders.taxablePaise)}`}
            />
            <Stat
              label="Pending approval"
              tone={summary.pendingApproval.count > 0 ? 'warning' : 'default'}
              value={summary.pendingApproval.count}
              sub={user?.role === 'ADMIN'
                ? <Link className="font-medium text-blue-700 underline" to="/orders?status=SUBMITTED">Review submitted orders</Link>
                : 'Submitted orders awaiting review'}
            />
            <Stat
              label="Invoiced today"
              value={summary.today.invoices.count}
              sub={formatPaise(summary.today.invoices.totalPaise)}
            />
            <Stat
              label="Collected today"
              value={summary.today.payments.count}
              sub={formatPaise(summary.today.payments.amountPaise)}
            />
            <Stat
              label="Outstanding dues"
              tone={summary.receivables.outstandingPaise > 0 ? 'warning' : 'default'}
              value={formatPaise(summary.receivables.outstandingPaise)}
              sub={summary.receivables.over90Paise > 0
                ? <span className="font-medium text-amber-700">91+ days: {formatPaise(summary.receivables.over90Paise)}</span>
                : 'Customer balances currently due'}
            />
          </section>

          <section aria-label="Dashboard details" className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="Stock levels">
              {stockCount === 0 ? (
                <EmptyState title="No stock items" message="Active inventory items will appear here." />
              ) : (
                <div className="space-y-5">
                  <StockRows label="Finished goods" items={summary.stock.finished} lowIds={lowIds} />
                  <StockRows label="Raw materials" items={summary.stock.raw} lowIds={lowIds} />
                  <StockRows label="Packaging" items={summary.stock.packaging} lowIds={lowIds} />
                </div>
              )}
            </Panel>

            <Panel title="Variance alerts">
              {summary.variance.recentAlerts.length === 0 ? (
                <EmptyState title="No flagged production runs" message="Recent yield and material variance alerts will appear here." />
              ) : (
                <ul className="space-y-4">
                  {summary.variance.recentAlerts.map((run) => (
                    <li className="rounded-lg border border-amber-200 bg-amber-50 p-3" key={run.runId}>
                      <Link className="font-semibold text-blue-700 underline" to={`/production/runs/${run.runId}`}>
                        {run.runNo}
                      </Link>
                      <p className="mt-1 text-xs text-slate-600">{run.date}</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-800">
                        {run.alerts.map((alert) => <li key={alert}>{alert}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Cost per packet and margin">
              {!summary.costing.latestRun ? (
                <EmptyState title="No completed production run" message="Product costing will appear after a run is completed." />
              ) : (
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-sm text-slate-600">Product</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{summary.costing.product.name}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-slate-600">Cost per packet</dt>
                    <dd className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                      {summary.costing.latestRun.costPerPacketDisplay ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-slate-600">Margin</dt>
                    <dd className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                      {summary.costing.marginBp === null ? '—' : formatBp(summary.costing.marginBp)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-slate-600">Selling price</dt>
                    <dd className="mt-1 font-medium tabular-nums text-slate-900">
                      {summary.costing.sellingPricePaise === null
                        ? '—'
                        : formatPaise(summary.costing.sellingPricePaise)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-slate-600">Latest run</dt>
                    <dd className="mt-1 font-medium text-slate-900">{summary.costing.latestRun.runNo}</dd>
                  </div>
                </dl>
              )}
            </Panel>

            <Panel title="Shortages">
              {summary.shortages.items.length === 0 ? (
                <EmptyState title="No packet shortages" message="Submitted order demand is covered by available stock." />
              ) : (
                <>
                  {singleShortage && (
                    <p className="mb-3 text-lg font-semibold text-red-700">
                      Short by {summary.shortages.totalShortPackets} packets
                      {singleShortage.suggestedBatches !== null
                        ? ` - suggested ${singleShortage.suggestedBatches} ${singleShortage.suggestedBatches === 1 ? 'batch' : 'batches'}`
                        : ''}
                    </p>
                  )}
                  <ul className="space-y-2">
                    {summary.shortages.items.map((item) => (
                      <li className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm" key={item.itemId}>
                        <span className="font-medium text-slate-800">{item.name}</span>
                        <span className="tabular-nums text-slate-700">
                          {singleShortage ? '' : `Short by ${item.shortPackets} packets`}
                          {!singleShortage && item.suggestedBatches !== null
                            ? ` - suggested ${item.suggestedBatches} ${item.suggestedBatches === 1 ? 'batch' : 'batches'}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>

            <Panel title="Top debtors" className="xl:col-span-2">
              <Table
                columns={[
                  { key: 'name', label: 'Customer' },
                  {
                    key: 'outstandingPaise',
                    label: 'Outstanding',
                    render: (customer) => formatPaise(customer.outstandingPaise)
                  }
                ]}
                emptyMessage="No customers have outstanding balances."
                rows={summary.receivables.topCustomers}
              />
            </Panel>
          </section>
        </>
      )}
    </div>
  );
}
