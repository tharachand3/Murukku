import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button.jsx';
import { Input } from '../../../components/ui/Input.jsx';
import { Modal } from '../../../components/ui/Modal.jsx';
import { Select } from '../../../components/ui/Select.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { api } from '../../../lib/api.js';
import { fieldErrors, toApiError } from '../../../lib/apiError.js';
import { formatPaise, parseRupeesToPaise, paiseToInput } from '../../../lib/money.js';

const MODES = ['CASH', 'UPI', 'BANK', 'CHEQUE'];

function paymentDateAtNoonIST(date) {
  if (!date) return undefined;
  return new Date(`${date}T12:00:00+05:30`).toISOString();
}

export function PaymentModal({
  open,
  customerId,
  invoiceId,
  duePaise,
  onClose,
  onSaved
}) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('CASH');
  const [reference, setReference] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setAmount(paiseToInput(duePaise));
    setMode('CASH');
    setReference('');
    setPaymentDate('');
    setErrorMessage('');
    setErrors({});
  }, [open, duePaise, invoiceId]);

  const submit = async (event) => {
    event.preventDefault();
    if (pendingRef.current) return;
    setErrorMessage('');
    setErrors({});

    let amountPaise;
    try {
      amountPaise = parseRupeesToPaise(amount);
    } catch (error) {
      setErrors({ amount: error.message });
      return;
    }
    if (amountPaise < 1) {
      setErrors({ amount: 'Enter an amount greater than zero.' });
      return;
    }
    if (amountPaise > duePaise) {
      setErrors({ amount: `Amount cannot exceed the due of ${formatPaise(duePaise)}.` });
      return;
    }
    const trimmedReference = reference.trim();
    if (mode !== 'CASH' && trimmedReference.length < 3) {
      setErrors({ reference: 'Enter a reference of at least 3 characters for this mode.' });
      return;
    }

    pendingRef.current = true;
    setPending(true);
    const payload = {
      customerId,
      invoiceId,
      amountPaise,
      mode,
      ...(trimmedReference ? { reference: trimmedReference } : {}),
      ...(paymentDate ? { paymentDate: paymentDateAtNoonIST(paymentDate) } : {})
    };
    try {
      const { data } = await api.post('/payments', payload);
      toast.success(data.payment?.receiptNo
        ? `Payment recorded: ${data.payment.receiptNo}`
        : 'Payment recorded.');
      onSaved?.(data);
    } catch (error) {
      const apiError = toApiError(error);
      const serverFields = fieldErrors(apiError.details);
      if (serverFields.amountPaise) {
        serverFields.amount = serverFields.amountPaise;
        delete serverFields.amountPaise;
      }
      if (apiError.code === 'OVERPAYMENT'
        && Number.isSafeInteger(apiError.details?.dueSoFarPaise)) {
        setErrorMessage(
          `${apiError.message}. Current due: ${formatPaise(apiError.details.dueSoFarPaise)}.`
        );
      } else {
        setErrorMessage(apiError.message);
      }
      setErrors(serverFields);
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
      title="Record payment"
    >
      <form className="space-y-4" noValidate onSubmit={submit}>
        <p className="text-sm text-slate-700">Outstanding due: {formatPaise(duePaise)}</p>
        <Input
          error={errors.amount}
          id="payment-amount"
          inputMode="decimal"
          label="Amount (Rs)"
          onChange={(event) => {
            setAmount(event.target.value);
            setErrors((current) => ({ ...current, amount: undefined }));
            setErrorMessage('');
          }}
          required
          type="text"
          value={amount}
        />
        <Select
          label="Payment mode"
          onChange={(event) => {
            setMode(event.target.value);
            setErrors((current) => ({ ...current, reference: undefined }));
            setErrorMessage('');
          }}
          value={mode}
        >
          {MODES.map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        <Input
          error={errors.reference}
          id="payment-reference"
          label="Reference"
          maxLength={60}
          minLength={mode === 'CASH' ? undefined : 3}
          onChange={(event) => {
            setReference(event.target.value);
            setErrors((current) => ({ ...current, reference: undefined }));
            setErrorMessage('');
          }}
          required={mode !== 'CASH'}
          value={reference}
        />
        <Input
          error={errors.paymentDate}
          id="payment-date"
          label="Payment date (optional)"
          onChange={(event) => {
            setPaymentDate(event.target.value);
            setErrors((current) => ({ ...current, paymentDate: undefined }));
            setErrorMessage('');
          }}
          type="date"
          value={paymentDate}
        />
        {errorMessage && (
          <p className="text-sm text-red-800" role="alert">{errorMessage}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button disabled={pending} onClick={onClose} variant="secondary">Cancel</Button>
          <Button disabled={pending} loading={pending} type="submit">Save payment</Button>
        </div>
      </form>
    </Modal>
  );
}
