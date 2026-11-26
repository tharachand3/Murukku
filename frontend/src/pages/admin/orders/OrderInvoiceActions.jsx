import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { api } from '../../../lib/api.js';
import { toApiError } from '../../../lib/apiError.js';

export default function OrderInvoiceActions({ order, onChanged }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const pendingRef = useRef(false);
  if (user?.role !== 'ADMIN') return null;

  if (['INVOICED', 'DISPATCHED'].includes(order.status) && order.invoice?.id) {
    return (
      <Link className="inline-flex min-h-11 items-center font-medium text-blue-800 underline"
        to={`/invoices/${order.invoice.id}`}>
        Open invoice {order.invoice.invoiceNo}
      </Link>
    );
  }
  if (order.status !== 'APPROVED' || order.invoice) return null;

  const createInvoice = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setErrorMessage('');
    try {
      const { data } = await api.post('/invoices', { orderId: order.id });
      if (!Number.isSafeInteger(data?.id) || data.id < 1) {
        throw new TypeError('The server returned an invalid invoice');
      }
      onChanged?.();
      navigate(`/invoices/${data.id}`);
    } catch (error) {
      setErrorMessage(toApiError(error).message);
    } finally {
      pendingRef.current = false;
      setPending(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-3">
      {errorMessage && <p className="text-sm text-red-800" role="alert">{errorMessage}</p>}
      <Button onClick={() => setConfirmOpen(true)}>Create GST invoice</Button>
      <ConfirmDialog
        confirmText="Create invoice"
        loading={pending}
        message="Create an immutable GST invoice from this approved order?"
        onCancel={() => {
          if (!pending) setConfirmOpen(false);
        }}
        onConfirm={createInvoice}
        open={confirmOpen}
        title="Create GST invoice"
        variant="primary"
      />
    </div>
  );
}
