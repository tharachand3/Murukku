import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { DateRange } from '../../components/ui/DateRange.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { toApiError } from '../../lib/apiError.js';
import { formatDateTimeIST, rangePreset } from '../../lib/date.js';
import { downloadAuthenticatedFile } from '../../lib/download.js';
import { useToast } from '../../context/ToastContext.jsx';

function istDayBounds(range) {
  return {
    from: `${range.from}T00:00:00+05:30`,
    to: `${range.to}T23:59:59.999+05:30`
  };
}

export default function StockLedgerPage({ now = new Date() }) {
  const { itemId } = useParams();
  const toast = useToast();
  const [range, setRange] = useState(() => rangePreset('thisFY', now));
  const [downloading, setDownloading] = useState('');
  const rangeValid = Boolean(range.from && range.to && range.from <= range.to);
  const rangeError = !range.from || !range.to
    ? 'Choose both a start and end date.'
    : 'The start date must be on or before the end date.';
  const bounds = rangeValid ? istDayBounds(range) : null;
  const queryKey = `${itemId}|${bounds?.from ?? ''}|${bounds?.to ?? ''}`;
  const itemRequest = useAsync(async () => {
    const { data } = await api.get(`/items/${itemId}`);
    return data;
  }, [itemId]);
  const ledgerRequest = useAsync(async () => {
    const { data } = await api.get('/stock/ledger', {
      params: { itemId, ...bounds }
    });
    if (!Array.isArray(data?.rows)) {
      throw new TypeError('The server returned an invalid stock ledger');
    }
    return { ...data, queryKey };
  }, [queryKey], { immediate: Boolean(bounds) });
  const ledger = ledgerRequest.data?.queryKey === queryKey ? ledgerRequest.data : null;
  const failure = itemRequest.error ?? ledgerRequest.error;

  const download = async (format) => {
    setDownloading(format);
    try {
      await downloadAuthenticatedFile(
        '/reports/stock-ledger/export',
        { itemId: Number(itemId), from: range.from, to: range.to, format },
        `stock-ledger-${itemId}.${format}`
      );
      toast.success(`${format.toUpperCase()} download started.`);
    } catch (error) {
      toast.error(toApiError(error).message);
    } finally {
      setDownloading('');
    }
  };

  const retry = () => {
    itemRequest.reload();
    ledgerRequest.reload();
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">
          Stock ledger{itemRequest.data ? ` · ${itemRequest.data.name}` : ''}
        </h1>
        <p className="mt-1 text-sm text-slate-600">Movement history and running balance in display units.</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <DateRange from={range.from} now={now} onChange={setRange} to={range.to} />
        {!rangeValid && (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {rangeError}
          </p>
        )}
      </section>

      {rangeValid && ledger && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-600">Opening balance</p>
            <p className="mt-1 text-xl font-semibold">{ledger.openingBalanceDisplay}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-600">Closing balance</p>
            <p className="mt-1 text-xl font-semibold">{ledger.closingBalanceDisplay}</p>
          </div>
        </div>
      )}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Ledger movements</h2>
          <div className="flex flex-wrap gap-2">
            {[
              ['csv', 'CSV'],
              ['xlsx', 'Excel'],
              ['pdf', 'PDF']
            ].map(([format, label]) => (
              <Button
                disabled={!rangeValid || Boolean(downloading)}
                key={format}
                loading={downloading === format}
                onClick={() => download(format)}
                variant="secondary"
              >
                Download {label}
              </Button>
            ))}
          </div>
        </div>

        {(itemRequest.loading || ledgerRequest.loading) && (
          <Spinner label="Loading stock ledger" />
        )}
        {failure && <ErrorBox message={failure.message} onRetry={retry} />}
        {rangeValid && ledger && !ledgerRequest.loading && ledger.rows.length === 0 && (
          <EmptyState message="There are no movements in this date range." title="No ledger movements" />
        )}
        {rangeValid && ledger && !ledgerRequest.loading && ledger.rows.length > 0 && (
          <Table
            columns={[
              { key: 'date', label: 'Date and time (IST)', render: (row) => formatDateTimeIST(row.date) },
              { key: 'movementType', label: 'Movement' },
              {
                key: 'sourceRef',
                label: 'Source document',
                render: (row) => `${row.sourceRef} (${row.sourceType})`
              },
              { key: 'qtyInDisplay', label: `In (${ledger.displayUnit})` },
              { key: 'qtyOutDisplay', label: `Out (${ledger.displayUnit})` },
              { key: 'balanceDisplay', label: `Running balance (${ledger.displayUnit})` },
              { key: 'note', label: 'Note', render: (row) => row.note || '—' }
            ]}
            rows={ledger.rows}
          />
        )}
      </section>
    </main>
  );
}
