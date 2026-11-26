import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button.jsx';
import { Input } from '../../../components/ui/Input.jsx';
import { Modal } from '../../../components/ui/Modal.jsx';
import { Textarea } from '../../../components/ui/Textarea.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { api } from '../../../lib/api.js';
import { fieldErrors, toApiError } from '../../../lib/apiError.js';

function initialQuantities(lines) {
  return Object.fromEntries(lines.map((line) => [line.itemId, String(line.remainingQty)]));
}

export default function DispatchModal({
  open,
  invoiceId,
  lines,
  onClose,
  onSaved
}) {
  const toast = useToast();
  const [quantities, setQuantities] = useState({});
  const [vehicleNo, setVehicleNo] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const [errorMessage, setErrorMessage] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setQuantities(initialQuantities(lines));
    setVehicleNo('');
    setNotes('');
    setErrors({});
    setErrorMessage('');
  }, [open, lines]);

  const submit = async (event) => {
    event.preventDefault();
    if (pendingRef.current) return;
    setErrors({});
    setErrorMessage('');
    const lineErrors = {};
    const dispatchLines = [];
    for (const line of lines) {
      const value = quantities[line.itemId] ?? String(line.remainingQty);
      if (!/^\d+$/.test(value)) {
        lineErrors[`qty-${line.itemId}`] = 'Enter a whole quantity from 0 to the remaining amount.';
        continue;
      }
      const qty = Number(value);
      if (!Number.isSafeInteger(qty) || qty < 0 || qty > line.remainingQty) {
        lineErrors[`qty-${line.itemId}`] = `Enter a whole quantity from 0 to ${line.remainingQty}.`;
        continue;
      }
      if (qty > 0) dispatchLines.push({ itemId: line.itemId, qty });
    }
    if (vehicleNo.trim().length > 20) {
      lineErrors.vehicleNo = 'Vehicle number must be 20 characters or fewer.';
    }
    if (notes.trim().length > 300) {
      lineErrors.notes = 'Notes must be 300 characters or fewer.';
    }
    if (dispatchLines.length === 0) {
      lineErrors.lines = 'Enter a quantity greater than zero for at least one item.';
    }
    if (Object.keys(lineErrors).length > 0) {
      setErrors(lineErrors);
      return;
    }

    pendingRef.current = true;
    setPending(true);
    try {
      await api.post('/dispatches', {
        invoiceId,
        lines: dispatchLines,
        ...(vehicleNo.trim() ? { vehicleNo: vehicleNo.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {})
      });
      toast.success('Dispatch recorded.');
      onSaved?.();
    } catch (error) {
      const apiError = toApiError(error);
      const serverFields = fieldErrors(apiError.details);
      if (apiError.code === 'INSUFFICIENT_STOCK') {
        const details = apiError.details ?? {};
        const shortBy = Number.isSafeInteger(details.shortBy) ? details.shortBy : null;
        const reserved = Number.isSafeInteger(details.reservedByOthers)
          ? details.reservedByOthers
          : null;
        const extra = [
          shortBy === null ? null : `Short by ${shortBy} packets.`,
          reserved === null ? null : `${reserved} packets are reserved by other orders.`
        ].filter(Boolean).join(' ');
        setErrorMessage(extra ? `${apiError.message}. ${extra}` : apiError.message);
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
      title="Dispatch invoice"
    >
      <form className="space-y-4" noValidate onSubmit={submit}>
        <div className="space-y-3">
          {lines.map((line) => (
            <Input
              key={line.itemId}
              error={errors[`qty-${line.itemId}`]}
              id={`dispatch-qty-${line.itemId}`}
              label={`${line.name} (remaining ${line.remainingQty})`}
              max={line.remainingQty}
              min="0"
              onChange={(event) => {
                setQuantities((current) => ({ ...current, [line.itemId]: event.target.value }));
                setErrors((current) => ({ ...current, [`qty-${line.itemId}`]: undefined, lines: undefined }));
                setErrorMessage('');
              }}
              step="1"
              type="number"
              value={quantities[line.itemId] ?? String(line.remainingQty)}
            />
          ))}
        </div>
        {errors.lines && <p className="text-sm text-red-700" role="alert">{errors.lines}</p>}
        <Input
          error={errors.vehicleNo}
          id="dispatch-vehicle"
          label="Vehicle number (optional)"
          maxLength={20}
          onChange={(event) => {
            setVehicleNo(event.target.value);
            setErrors((current) => ({ ...current, vehicleNo: undefined }));
            setErrorMessage('');
          }}
          value={vehicleNo}
        />
        <Textarea
          error={errors.notes}
          id="dispatch-notes"
          label="Notes (optional)"
          maxLength={300}
          onChange={(event) => {
            setNotes(event.target.value);
            setErrors((current) => ({ ...current, notes: undefined }));
            setErrorMessage('');
          }}
          value={notes}
        />
        {errorMessage && <p className="text-sm text-red-800" role="alert">{errorMessage}</p>}
        <div className="flex justify-end gap-2">
          <Button disabled={pending} onClick={onClose} variant="secondary">Cancel</Button>
          <Button disabled={pending} loading={pending} type="submit">Save dispatch</Button>
        </div>
      </form>
    </Modal>
  );
}
