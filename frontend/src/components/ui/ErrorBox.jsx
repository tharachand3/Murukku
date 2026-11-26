import { Button } from './Button.jsx';

// Retryable error message for failed page requests.
export function ErrorBox({ message, onRetry, loading = false }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900" role="alert">
      <p>{message}</p>
      {onRetry && (
        <Button className="mt-3" loading={loading} onClick={onRetry} variant="secondary">
          Retry
        </Button>
      )}
    </div>
  );
}
