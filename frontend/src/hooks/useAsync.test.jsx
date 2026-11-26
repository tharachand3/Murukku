import { act, render, screen } from '@testing-library/react';
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
});
