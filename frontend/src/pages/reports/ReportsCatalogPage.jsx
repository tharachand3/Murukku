import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';

const GROUP_LABELS = {
  sales: 'Sales',
  gst: 'GST',
  stock: 'Stock',
  purchases: 'Purchases',
  production: 'Production',
  receivables: 'Receivables',
  costing: 'Costing'
};

function readCatalog(data) {
  if (!Array.isArray(data)) {
    throw new TypeError('The server returned an invalid reports catalog');
  }
  return data;
}

export default function ReportsCatalogPage() {
  const request = useAsync(async () => {
    const { data } = await api.get('/reports');
    return readCatalog(data);
  }, []);

  const groups = (request.data ?? []).reduce((result, report) => {
    const reports = result.get(report.group) ?? [];
    reports.push(report);
    result.set(report.group, reports);
    return result;
  }, new Map());

  return (
    <main className="mx-auto max-w-7xl space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
        <p className="mt-1 text-sm text-slate-600">Operational, financial and compliance reports.</p>
      </header>

      {request.loading && <Spinner label="Loading reports" />}
      {request.error && (
        <ErrorBox
          loading={request.loading}
          message={request.error.message}
          onRetry={request.reload}
        />
      )}
      {!request.loading && !request.error && groups.size === 0 && (
        <EmptyState message="No reports are available for your role." title="No reports" />
      )}

      {!request.loading && !request.error && Array.from(groups.entries()).map(([group, reports]) => (
        <section className="space-y-3" key={group}>
          <h2 className="text-lg font-semibold text-slate-900">
            {GROUP_LABELS[group] ?? group}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reports.map((report) => (
              <article className="rounded-xl border border-slate-200 bg-white p-5" key={report.key}>
                <h3 className="font-semibold text-slate-900">{report.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{report.description}</p>
                <Link
                  className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 font-medium text-white hover:bg-blue-800"
                  to={`/reports/${report.key}`}
                >
                  Open
                </Link>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
