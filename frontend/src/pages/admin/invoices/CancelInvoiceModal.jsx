import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button.jsx';
import { Modal } from '../../../components/ui/Modal.jsx';
import { Textarea } from '../../../components/ui/Textarea.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { api } from '../../../lib/api.js';
import { fieldErrors, toApiError } from '../../../lib/apiError.js';

export default function CancelInvoiceModal({ open, invoiceId, onClose, onSaved }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setErrorMessage('');
    setReasonError('');
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    if (pendingRef.current) return;
    const trimmed = reason.trim();
    if (trimmed.length < 5 || trimmed.length > 300) {
      setReasonError('Enter a cancellation reason between 5 and 300 characters.');
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setErrorMessage('');
    setReasonError('');
    try {
      const { data } = await api.post(`/invoices/${invoiceId}/cancel`, { reason: trimmed });
      toast.success(`Invoice cancelled. Credit note ${data.creditNote.noteNo} created.`);
      onSaved?.(data);
    } catch (error) {
      const apiError = toApiError(error);
      setErrorMessage(apiError.message);
      setReasonError(fieldErrors(apiError.details).reason ?? '');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <Modal
      onClose={() => {
        if (!pending) onClose?.();
      }}
      open={open}
      persistent={pending}
      title="Cancel invoice"
    >
      <form className="space-y-4" noValidate onSubmit={submit}>
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This creates a credit note and returns dispatched goods to stock. This cannot be undone.
        </p>
        <Textarea
          error={reasonError}
          id="invoice-cancel-reason"
          label="Reason"
          maxLength={300}
          minLength={5}
          onChange={(event) => {
            setReason(event.target.value);
            setReasonError('');
            setErrorMessage('');
          }}
          required
          value={reason}
        />
        {errorMessage && <p className="text-sm text-red-800" role="alert">{errorMessage}</p>}
        <div className="flex justify-end gap-2">
          <Button disabled={pending} onClick={onClose} variant="secondary">Keep invoice</Button>
          <Button disabled={pending} loading={pending} type="submit" variant="danger">
            Cancel invoice
          </Button>
        </div>
      </form>
    </Modal>
  );
}
