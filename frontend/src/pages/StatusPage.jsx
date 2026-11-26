import { api } from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card } from '../components/ui/Card.jsx';
import { ErrorBox } from '../components/ui/ErrorBox.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';

// Public API status card, retained from the original application shell.
export default function StatusPage() {
  const { data, error, loading, reload } = useAsync(
    async () => {
      const response = await api.get('/health');
      return response.data;
    },
    []
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
      <Card className="w-full max-w-md text-center">
        <h1 className="text-2xl font-bold text-slate-900">Order-to-Audit System</h1>
        {loading && <div className="mt-4"><Spinner label="Checking API" /></div>}
        {error && (
          <div className="mt-4 text-left">
            <ErrorBox message={`${error.message} (API: down)`} onRetry={reload} />
          </div>
        )}
        {data && <p className="mt-4 font-medium text-green-700">API: connected</p>}
      </Card>
    </main>
  );
}
