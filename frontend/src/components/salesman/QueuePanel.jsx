import { useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog.jsx';
import { ErrorBox } from '../ui/ErrorBox.jsx';
import { StatusBadge } from '../ui/StatusBadge.jsx';
import { discardFailed } from '../../lib/orderQueue.js';
import { formatDateTimeIST } from '../../lib/date.js';

export function QueuePanel({ queue }) {
  const [discardRef, setDiscardRef] = useState(null);
  if (!queue.items.length && !queue.error) return null;

  const discardItem = queue.items.find((item) => item.clientRef === discardRef);
  const confirmDiscard = () => {
    if (discardRef) {
      discardFailed(discardRef);
      queue.refresh();
      setDiscardRef(null);
    }
  };

  return (
    <section aria-label="Offline order queue" className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Offline order queue</h2>
          <p className="text-sm text-slate-600">
            {queue.pendingCount} pending · {queue.failedCount} failed
          </p>
        </div>
        <button
          className="min-h-11 rounded-lg bg-blue-700 px-4 font-medium text-white disabled:opacity-60"
          disabled={queue.flushing || queue.pendingCount === 0}
          onClick={() => queue.flush().catch(() => {})}
          type="button"
        >
          {queue.flushing ? 'Sending…' : 'Send now'}
        </button>
      </div>

      {queue.error && (
        <div className="mt-3">
          <ErrorBox
            loading={queue.flushing}
            message={queue.error.message}
            onRetry={() => queue.flush().catch(() => {})}
          />
        </div>
      )}

      {queue.items.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100">
          {queue.items.map((item) => (
            <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={item.clientRef}>
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{item.customerName || `Customer ${item.customerId}`}</p>
                <p className="text-xs text-slate-500">
                  {item.lines.map((line) => `${line.qty} ${line.name}`).join(', ')}
                  {' · '}
                  {formatDateTimeIST(item.createdAt)}
                </p>
                {item.lastError && <p className="mt-1 text-sm text-red-700">{item.lastError}</p>}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={item.state} />
                {item.state === 'FAILED' && (
                  <button
                    className="min-h-11 rounded px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                    onClick={() => setDiscardRef(item.clientRef)}
                    type="button"
                  >
                    Discard
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        confirmText="Discard"
        message={`Discard the failed order for ${discardItem?.customerName || 'this customer'}?`}
        onCancel={() => setDiscardRef(null)}
        onConfirm={confirmDiscard}
        open={Boolean(discardItem)}
        title="Discard failed order"
      />
    </section>
  );
}
