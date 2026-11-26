import { useState } from 'react';
import { Button } from '../../../components/ui/Button.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../../components/ui/ErrorBox.jsx';
import { Modal } from '../../../components/ui/Modal.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAsync } from '../../../hooks/useAsync.js';
import { api } from '../../../lib/api.js';
import { formatDateTimeIST } from '../../../lib/date.js';

export default function ShareModal({ open, invoiceId, onClose }) {
  const toast = useToast();
  const [copyError, setCopyError] = useState('');
  const request = useAsync(async () => {
    const { data } = await api.get(`/invoices/${invoiceId}/share`);
    return data;
  }, [invoiceId, open], { immediate: open });
  const loading = request.loading || (open && !request.data && !request.error);

  const copyLink = async () => {
    setCopyError('');
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is unavailable');
      }
      await navigator.clipboard.writeText(request.data.pdfUrl);
      toast.success('Invoice link copied.');
    } catch {
      const copied = window.prompt('Copy this invoice link', request.data.pdfUrl);
      if (copied !== null) {
        toast.success('Invoice link is ready to copy.');
      } else {
        setCopyError('Could not copy the invoice link.');
      }
    }
  };

  return (
    <Modal onClose={onClose} open={open} title="Share invoice">
      {loading && (
        <p className="text-sm text-slate-600" role="status">Creating a share link…</p>
      )}
      {request.error && (
        <ErrorBox
          loading={loading}
          message={request.error.message}
          onRetry={request.reload}
        />
      )}
      {!loading && !request.error && request.data && (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            Link expires {formatDateTimeIST(request.data.expiresAt)} IST.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              className="inline-flex min-h-11 items-center rounded-lg bg-green-700 px-4 py-2 font-medium text-white"
              href={request.data.whatsappUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              WhatsApp
            </a>
            <a
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-800"
              href={request.data.mailtoUrl}
            >
              Email
            </a>
            <Button onClick={copyLink} variant="secondary">Copy link</Button>
          </div>
          {copyError && <p className="text-sm text-red-800" role="alert">{copyError}</p>}
          <p className="break-all text-xs text-slate-500">{request.data.pdfUrl}</p>
        </div>
      )}
      {!loading && !request.error && !request.data && (
        <EmptyState title="Share link unavailable" />
      )}
      <div className="mt-5 flex justify-end">
        <Button onClick={onClose} variant="secondary">Close</Button>
      </div>
    </Modal>
  );
}
