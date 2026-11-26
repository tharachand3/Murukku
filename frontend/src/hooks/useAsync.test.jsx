import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAsync } from './useAsync.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function AsyncResult({ request }) {
  const result = useAsync(() => request.promise, [request]);
  return <p>{result.loading ? 'Loading' : result.data}</p>;
}

function ReloadableResult({ requests }) {
  const result = useAsync(() => requests.shift().promise, []);
  return (
    <>
      <p>{result.data ?? 'Loading data'}</p>
      <p>{result.loading ? 'Loading' : 'Not loading'}</p>
      <p>{result.refreshing ? 'Refreshing' : 'Not refreshing'}</p>
      <button onClick={() => result.reload({ silent: true })} type="button">Refresh silently</button>
    </>
  );
}

describe('useAsync', () => {
  it('ignores a stale response after its dependencies change', async () => {
    const oldRequest = deferred();
    const newRequest = deferred();
    const { rerender } = render(<AsyncResult request={oldRequest} />);
    rerender(<AsyncResult request={newRequest} />);

    await act(async () => newRequest.resolve('latest'));
    expect(screen.getByText('latest')).toBeInTheDocument();
    await act(async () => oldRequest.resolve('stale'));
    expect(screen.getByText('latest')).toBeInTheDocument();
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
  });

  it('keeps existing data and loading state unchanged during a silent refresh', async () => {
    const initialRequest = deferred();
    const refreshRequest = deferred();
    const requests = [initialRequest, refreshRequest];
    render(<ReloadableResult requests={requests} />);

    await act(async () => initialRequest.resolve('current data'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh silently' }));

    expect(screen.getByText('current data')).toBeInTheDocument();
    expect(screen.getByText('Not loading')).toBeInTheDocument();
    expect(screen.getByText('Refreshing')).toBeInTheDocument();

    await act(async () => refreshRequest.resolve('refreshed data'));
    expect(screen.getByText('refreshed data')).toBeInTheDocument();
    expect(screen.getByText('Not refreshing')).toBeInTheDocument();
  });
});
