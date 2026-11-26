import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { formatDateTimeIST } from '../../lib/date.js';

const PAGE_SIZE = 20;

function positiveInteger(value) {
  if (!/^[1-9]\d*$/.test(value ?? '')) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readRuns(data) {
  if (!Array.isArray(data?.items)) {
    throw new TypeError('The server returned an invalid production run list');
  }
  return data;
}

export default function RunsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? 'ALL';
  const page = positiveInteger(searchParams.get('page')) ?? 1;
  const params = { page, limit: PAGE_SIZE };
  if (status !== 'ALL') params.status = status;
  const queryKey = JSON.stringify(params);
  const runsRequest = useAsync(async () => {
    const { data } = await api.get('/production/runs', { params });
    return { ...readRuns(data), queryKey };
  }, [queryKey]);
  const runs = runsRequest.data?.queryKey === queryKey ? runsRequest.data : null;
  const pageCount = runs ? Math.max(1, Math.ceil(runs.total / runs.limit)) : 1;
  const isWriter = user?.role === 'PRODUCTION' || user?.role === 'ADMIN';

  const updateQuery = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'ALL' || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.set('page', '1');
    setSearchParams(next);
  };

  const columns = [
    {
      key: 'runNo',
      label: 'Run',
      render: (run) => (
        <Link className="font-medium text-blue-800 underline" to={`/production/runs/${run.id}`}>
          {run.runNo}
        </Link>
      )
    },
    { key: 'product', label: 'Product', render: (run) => run.product?.name ?? '—' },
    { key: 'startedAt', label: 'Started (IST)', render: (run) => formatDateTimeIST(run.startedAt) },
    { key: 'completedAt', label: 'Completed (IST)', render: (run) => run.completedAt ? formatDateTimeIST(run.completedAt) : '—' },
    { key: 'status', label: 'Status', render: (run) => <StatusBadge status={run.status} /> },
    { key: 'plannedOutputQtyDisplay', label: 'Planned output' },
    { key: 'actualGoodQtyDisplay', label: 'Good output', render: (run) => run.actualGoodQtyDisplay ?? '—' },
    {
      key: 'flagsCount',
      label: 'Flags',
      render: (run) => run.flagsCount > 0
        ? <span className="font-semibold text-red-800">Flagged ({run.flagsCount})</span>
        : '—'
    }
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Production runs</h1>
          <p className="mt-1 text-sm text-slate-600">Track planned and actual production, variance flags, and run status.</p>
        </div>
        {isWriter && (
          <Link className="inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800"
            to="/production/new">
            New run
          </Link>
        )}
      </header>

      <div className="max-w-xs">
        <Select label="Status filter" onChange={(event) => updateQuery('status', event.target.value)} value={status}>
          <option value="ALL">All statuses</option>
          <option value="ISSUED">Issued</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>

      {runsRequest.loading && (
        <p className="text-sm text-slate-600" role="status">Loading production runs…</p>
      )}
      {runsRequest.error && (
        <ErrorBox loading={runsRequest.loading} message={runsRequest.error.message} onRetry={runsRequest.reload} />
      )}
      {!runsRequest.loading && !runsRequest.error && runs && runs.items.length === 0 && (
        <EmptyState title="No production runs" message="Start a run from an active BOM to see it here." />
      )}
      {runs && runs.items.length > 0 && (
        <>
          <Table columns={columns} rows={runs.items} />
          {pageCount > 1 && (
            <fieldset className="min-w-0 border-0 p-0" disabled={runsRequest.loading}>
              <Pagination
                onPage={(nextPage) => updateQuery('page', String(nextPage))}
                page={runs.page}
                pages={pageCount}
              />
            </fieldset>
          )}
        </>
      )}
    </div>
  );
}
