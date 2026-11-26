import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCard } from '../../components/alerts/AlertCard.jsx';
import { FlagChip } from '../../components/alerts/FlagChip.jsx';
import { LowStockChip } from '../../components/alerts/LowStockChip.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { addDays, formatDateIST, formatDateTimeIST, todayIST } from '../../lib/date.js';
import { toBaseUnits, UNIT_BASE_FACTORS } from '../../lib/decimal.js';
import { isLow, summarizeAlerts } from '../../lib/alerts.js';
import { api } from '../../lib/api.js';
import { toApiError } from '../../lib/apiError.js';

const VARIANCE_LIMIT = 100;
const ALERT_PERIODS = [7, 30, 90];
const STOCK_TYPES = new Set(['RAW', 'PACKAGING']);

function readArray(data, label) {
  if (!Array.isArray(data)) {
    throw new TypeError(`The server returned an invalid ${label} list`);
  }
  return data;
}

function readVariancePage(data) {
  if (
    !Array.isArray(data?.items)
    || !Number.isSafeInteger(data.total)
    || data.total < 0
    || !Number.isSafeInteger(data.limit)
    || data.limit <= 0
  ) {
    throw new TypeError('The server returned an invalid production variance list');
  }
  return data;
}

function istStart(date) {
  return new Date(`${date}T00:00:00+05:30`).toISOString();
}

function istEnd(date) {
  const end = new Date(`${addDays(date, 1)}T00:00:00+05:30`);
  end.setTime(end.getTime() - 1);
  return end.toISOString();
}

function unitFactor(unitCode) {
  const factor = UNIT_BASE_FACTORS[unitCode];
  if (!Number.isSafeInteger(factor) || factor <= 0) {
    throw new TypeError(`No base-unit conversion is configured for ${unitCode}`);
  }
  return factor;
}

function formatBaseQuantity(baseQuantity, factor) {
  if (!Number.isSafeInteger(baseQuantity)) {
    throw new TypeError('A quantity must be a safe integer in base units');
  }
  let divisor = BigInt(factor);
  let decimalPlaces = 0;
  while (divisor > 1n && divisor % 10n === 0n) {
    divisor /= 10n;
    decimalPlaces += 1;
  }
  if (divisor !== 1n) {
    throw new TypeError('The display unit factor must be a power of ten');
  }

  const quantity = BigInt(baseQuantity);
  const negative = quantity < 0n;
  const absolute = negative ? -quantity : quantity;
  const factorBigInt = BigInt(factor);
  const whole = absolute / factorBigInt;
  const remainder = absolute % factorBigInt;
  const fraction = decimalPlaces > 0
    ? (remainder * (10n ** BigInt(decimalPlaces)))
      .toString()
      .padStart(decimalPlaces, '0')
      .replace(/0+$/, '')
    : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function convertReorderLevel(text, factor) {
  const value = text.trim();
  if (value === '') {
    return null;
  }
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) {
    throw new TypeError('Enter a non-negative value with up to 3 decimal places.');
  }
  if (/^0(?:\.0{1,3})?$/.test(value)) {
    return 0;
  }
  try {
    return toBaseUnits(value, factor);
  } catch (error) {
    if (error instanceof RangeError && error.message === 'Quantity cannot be represented in base units') {
      throw new TypeError('The value must convert to a whole base unit.');
    }
    throw error;
  }
}

async function loadVariance(range) {
  const params = {
    from: istStart(range.from),
    to: istEnd(range.to),
    flaggedOnly: true,
    page: 1,
    limit: VARIANCE_LIMIT
  };
  const { data: firstData } = await api.get('/production/variance', { params });
  const firstPage = readVariancePage(firstData);
  const pageCount = Math.ceil(firstPage.total / firstPage.limit);
  const laterPages = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, async (_, index) => {
      const { data } = await api.get('/production/variance', {
        params: { ...params, page: index + 2 }
      });
      return readVariancePage(data);
    })
  );
  const runs = [firstPage, ...laterPages].flatMap((page) => page.items);
  if (runs.length !== firstPage.total) {
    throw new TypeError('The server returned an incomplete production variance list');
  }
  const details = await Promise.all(runs.map(async (run) => {
    const { data } = await api.get(`/production/runs/${run.runId}/variance`);
    if (!Array.isArray(data?.alerts) || data.alerts.some((alert) => typeof alert !== 'string')) {
      throw new TypeError('The server returned invalid production variance alerts');
    }
    return data.alerts;
  }));
  return {
    items: runs.map((run, index) => ({ ...run, alerts: details[index] }))
  };
}

async function loadLowStock() {
  const [{ data: stockData }, { data: itemData }] = await Promise.all([
    api.get('/stock/summary'),
    api.get('/items', { params: { active: true } })
  ]);
  const balances = readArray(stockData, 'stock');
  const items = readArray(itemData, 'item').filter((item) => STOCK_TYPES.has(item.type));
  const balancesById = new Map(balances.map((row) => [row.itemId, row]));
  const lowItems = [];

  for (const item of items) {
    if (item.reorderLevelBase !== null && !Number.isSafeInteger(item.reorderLevelBase)) {
      throw new TypeError('The server returned an invalid reorder level');
    }
    const balance = balancesById.get(item.id);
    if (!balance || !isLow(balance.balanceBase, item.reorderLevelBase)) {
      continue;
    }
    const factor = unitFactor(item.displayUnit?.code);
    lowItems.push({
      ...item,
      balanceBase: balance.balanceBase,
      balanceDisplay: balance.balanceDisplay,
      reorderDisplay: formatBaseQuantity(item.reorderLevelBase, factor)
    });
  }

  return {
    lowItems,
    hasAnyLevel: items.some((item) => item.reorderLevelBase !== null)
  };
}

async function loadShortages() {
  const { data } = await api.get('/orders/shortages');
  if (
    !Array.isArray(data?.items)
    || !Number.isSafeInteger(data.totalShortPackets)
    || data.totalShortPackets < 0
  ) {
    throw new TypeError('The server returned an invalid shortage list');
  }
  return data;
}

async function loadReorderItems() {
  const { data } = await api.get('/items', { params: { active: true } });
  return readArray(data, 'item')
    .filter((item) => STOCK_TYPES.has(item.type))
    .map((item) => {
      if (item.reorderLevelBase !== null && !Number.isSafeInteger(item.reorderLevelBase)) {
        throw new TypeError('The server returned an invalid reorder level');
      }
      const factor = unitFactor(item.displayUnit?.code);
      return {
        ...item,
        reorderDisplay: item.reorderLevelBase === null
          ? ''
          : formatBaseQuantity(item.reorderLevelBase, factor)
      };
    });
}

function RequestFeedback({ request, retry, label }) {
  return (
    <>
      {request.loading && !request.data && <Spinner label={`Loading ${label}`} />}
      {request.error && (
        <ErrorBox
          loading={request.loading}
          message={request.error.message}
          onRetry={retry}
        />
      )}
      {request.loading && request.data && <Spinner label={`Refreshing ${label}`} small />}
    </>
  );
}

function sectionSummaryText(total, hasLoadedSection) {
  if (total === 0) {
    return hasLoadedSection ? 'All clear' : 'Alerts are not available yet';
  }
  return `${total} ${total === 1 ? 'thing needs' : 'things need'} attention`;
}

export default function AlertsPage({ now }) {
  const { user } = useAuth();
  const toast = useToast();
  const role = user?.role;
  const isAdmin = role === 'ADMIN';
  const canViewShortages = role === 'ADMIN' || role === 'OWNER';
  const [period, setPeriod] = useState(30);
  const [drafts, setDrafts] = useState({});
  const [saveErrors, setSaveErrors] = useState({});
  const [savingIds, setSavingIds] = useState([]);
  const savingIdsRef = useRef(new Set());
  const [lastUpdated, setLastUpdated] = useState(null);
  const clockNow = useMemo(() => now ?? new Date(), [now]);
  const dateRange = useMemo(() => {
    const to = todayIST(clockNow);
    return { from: addDays(to, -(period - 1)), to };
  }, [clockNow, period]);
  const loadVarianceForPeriod = useCallback(
    () => loadVariance(dateRange),
    [dateRange]
  );

  const varianceRequest = useAsync(loadVarianceForPeriod, [loadVarianceForPeriod]);
  const lowStockRequest = useAsync(loadLowStock, []);
  const shortagesRequest = useAsync(loadShortages, [], { immediate: canViewShortages });
  const reorderRequest = useAsync(loadReorderItems, [], { immediate: isAdmin });

  useEffect(() => {
    const items = reorderRequest.data;
    if (!items) {
      return;
    }
    setDrafts((current) => {
      const next = { ...current };
      for (const item of items) {
        if (!Object.hasOwn(next, item.id)) {
          next[item.id] = item.reorderDisplay;
        }
      }
      return next;
    });
  }, [reorderRequest.data]);

  useEffect(() => {
    if (
      varianceRequest.data
      || lowStockRequest.data
      || (canViewShortages && shortagesRequest.data)
      || (isAdmin && reorderRequest.data)
    ) {
      setLastUpdated(new Date());
    }
  }, [
    canViewShortages,
    isAdmin,
    lowStockRequest.data,
    reorderRequest.data,
    shortagesRequest.data,
    varianceRequest.data
  ]);

  const refreshAll = useCallback(() => {
    varianceRequest.reload({ silent: true });
    lowStockRequest.reload({ silent: true });
    if (canViewShortages) {
      shortagesRequest.reload({ silent: true });
    }
    if (isAdmin) {
      reorderRequest.reload({ silent: true });
    }
  }, [
    canViewShortages,
    isAdmin,
    lowStockRequest.reload,
    reorderRequest.reload,
    shortagesRequest.reload,
    varianceRequest.reload
  ]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshAll();
      }
    };
    const timer = window.setInterval(refreshIfVisible, 60000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [refreshAll]);

  const summary = summarizeAlerts({
    flaggedRuns: varianceRequest.data?.items.length,
    lowItems: lowStockRequest.data?.lowItems.length,
    shortPackets: canViewShortages ? shortagesRequest.data?.totalShortPackets : undefined
  });
  const hasLoadedSection = summary.flaggedRuns !== undefined
    || summary.lowItems !== undefined
    || summary.shortPackets !== undefined;
  const anyLoading = varianceRequest.loading
    || lowStockRequest.loading
    || (canViewShortages && shortagesRequest.loading)
    || (isAdmin && reorderRequest.loading);
  const anyRefreshing = varianceRequest.refreshing
    || lowStockRequest.refreshing
    || (canViewShortages && shortagesRequest.refreshing)
    || (isAdmin && reorderRequest.refreshing);

  async function saveReorderLevel(item) {
    if (savingIdsRef.current.has(item.id)) {
      return;
    }
    savingIdsRef.current.add(item.id);
    setSavingIds((current) => [...current, item.id]);
    setSaveErrors((current) => ({ ...current, [item.id]: undefined }));

    try {
      const reorderLevelBase = convertReorderLevel(
        drafts[item.id] ?? '',
        unitFactor(item.displayUnit.code)
      );
      await api.patch(`/items/${item.id}`, { reorderLevelBase });
      lowStockRequest.reload({ silent: true });
      reorderRequest.reload({ silent: true });
      toast.success('Reorder level saved.');
    } catch (error) {
      const message = error instanceof TypeError || error instanceof RangeError
        ? error.message
        : toApiError(error).message;
      setSaveErrors((current) => ({ ...current, [item.id]: message }));
    } finally {
      savingIdsRef.current.delete(item.id);
      setSavingIds((current) => current.filter((id) => id !== item.id));
    }
  }

  const reorderRows = (reorderRequest.data ?? []).map((item) => ({
    ...item,
    currentLevel: item.reorderLevelBase === null
      ? 'Not set'
      : `${item.reorderDisplay} ${item.displayUnit.code}`,
    editor: (
      <div className="flex min-w-[18rem] items-end gap-2">
        <Input
          className="min-w-0"
          error={saveErrors[item.id]}
          inputMode="decimal"
          label={`${item.name} reorder level (${item.displayUnit.code})`}
          maxLength={24}
          onChange={(event) => {
            const value = event.target.value;
            setDrafts((current) => ({ ...current, [item.id]: value }));
            setSaveErrors((current) => ({ ...current, [item.id]: undefined }));
          }}
          value={drafts[item.id] ?? ''}
        />
        <Button
          disabled={savingIds.includes(item.id)}
          loading={savingIds.includes(item.id)}
          onClick={() => saveReorderLevel(item)}
        >
          Save
        </Button>
      </div>
    )
  }));

  return (
    <main className="mx-auto max-w-7xl space-y-5 pb-8">
      <PageHeader
        actions={(
          <Button disabled={anyLoading || anyRefreshing} onClick={refreshAll} variant="secondary">
            Refresh
          </Button>
        )}
        subtitle="Production, stock, and order issues that need attention."
        title="Alerts"
      />

      <div aria-live="polite" className="rounded-lg bg-slate-100 px-4 py-3" role="status">
        <p className="font-semibold text-slate-900">
          {sectionSummaryText(summary.total, hasLoadedSection)}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Last updated {lastUpdated ? formatDateTimeIST(lastUpdated) : '—'} IST
        </p>
      </div>

      <section aria-labelledby="variance-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900" id="variance-heading">
              Variance alerts
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Flagged completed runs for the selected period.
            </p>
          </div>
          <div className="w-full sm:w-48">
            <label className="mb-1 block text-sm font-medium text-slate-800" htmlFor="variance-period">
              Period
            </label>
            <select
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              id="variance-period"
              onChange={(event) => setPeriod(Number(event.target.value))}
              value={period}
            >
              {ALERT_PERIODS.map((days) => (
                <option key={days} value={days}>Last {days} days</option>
              ))}
            </select>
          </div>
        </div>
        <RequestFeedback label="variance alerts" request={varianceRequest} retry={varianceRequest.reload} />
        {varianceRequest.data?.items.length === 0 && (
          <EmptyState
            message={`No flagged production runs in the last ${period} days.`}
            title="No variance alerts"
          />
        )}
        <div className="space-y-3">
          {varianceRequest.data?.items.map((run) => (
            <AlertCard
              action={(
                <div className="flex items-center gap-3">
                  <FlagChip />
                  <Link
                    className="font-medium text-blue-800 underline"
                    to={`/production/runs/${run.runId}`}
                  >
                    View run
                  </Link>
                </div>
              )}
              key={run.runId}
              title={`${run.runNo} - ${formatDateIST(run.completedAt)}`}
              tone="danger"
            >
              <ul className="list-inside list-disc space-y-1">
                {run.alerts.map((alert, index) => <li key={`${run.runId}-${index}`}>{alert}</li>)}
              </ul>
            </AlertCard>
          ))}
        </div>
      </section>

      <section aria-labelledby="stock-heading" className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900" id="stock-heading">Low stock</h2>
          <p className="mt-1 text-sm text-slate-600">Raw materials and packaging below their reorder levels.</p>
        </div>
        <RequestFeedback label="low stock" request={lowStockRequest} retry={lowStockRequest.reload} />
        {isAdmin && lowStockRequest.data && !lowStockRequest.data.hasAnyLevel && (
          <p className="text-sm text-slate-600">Set a reorder level to get warnings.</p>
        )}
        {lowStockRequest.data?.lowItems.length === 0 && (
          <EmptyState
            message="Items with no reorder level are not counted as low."
            title="No items below their reorder level"
          />
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {lowStockRequest.data?.lowItems.map((item) => (
            <AlertCard
              action={<LowStockChip balanceBase={item.balanceBase} reorderLevelBase={item.reorderLevelBase} />}
              key={item.id}
              title={item.name}
              tone="warning"
            >
              <p>Balance: {item.balanceDisplay}</p>
              <p>Reorder level: {item.reorderDisplay} {item.displayUnit.code}</p>
            </AlertCard>
          ))}
        </div>
      </section>

      {canViewShortages && (
        <section aria-labelledby="shortages-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900" id="shortages-heading">
                Order shortages
              </h2>
              <p className="mt-1 text-sm text-slate-600">Submitted demand not covered by free finished stock.</p>
            </div>
            <Link className="font-medium text-blue-800 underline" to="/shortages">
              View shortages
            </Link>
          </div>
          <RequestFeedback label="order shortages" request={shortagesRequest} retry={shortagesRequest.reload} />
          {shortagesRequest.data?.items.length === 0 && (
            <EmptyState
              message="Submitted orders are currently covered by free finished stock."
              title="No order shortages"
            />
          )}
          <div className="space-y-3">
            {shortagesRequest.data?.items.map((item) => (
              <AlertCard key={item.itemId} title={item.name} tone="danger">
                <p>
                  {item.message}
                  {Number.isSafeInteger(item.suggestedBatches)
                    ? ` - suggested ${item.suggestedBatches} ${item.suggestedBatches === 1 ? 'batch' : 'batches'}`
                    : ''}
                  .
                </p>
                <p className="mt-1 font-semibold">Short by {item.totalShortPackets} packets</p>
              </AlertCard>
            ))}
          </div>
        </section>
      )}

      {isAdmin && (
        <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-lg font-semibold text-slate-900">
            Reorder levels
          </summary>
          <div className="mt-4 space-y-3">
            <RequestFeedback
              label="reorder levels"
              request={reorderRequest}
              retry={reorderRequest.reload}
            />
            {reorderRequest.data?.length === 0 && (
              <EmptyState title="No raw material or packaging items" />
            )}
            {reorderRequest.data?.length > 0 && (
              <Table
                columns={[
                  { key: 'name', label: 'Item' },
                  { key: 'type', label: 'Type' },
                  { key: 'currentLevel', label: 'Current level' },
                  {
                    key: 'editor',
                    label: 'New reorder level',
                    render: (item) => item.editor
                  }
                ]}
                rows={reorderRows}
              />
            )}
          </div>
        </details>
      )}
    </main>
  );
}
