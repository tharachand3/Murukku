import { Button } from './Button.jsx';
import { Modal } from './Modal.jsx';

// Confirmation dialog with a pending-safe primary action.
export function ConfirmDialog({
  open,
  title = 'Confirm action',
  message,
  onConfirm,
  onCancel,
  confirmText = 'Confirm',
  loading = false,
  variant = 'danger'
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="text-sm text-slate-700">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button disabled={loading} onClick={onCancel} variant="secondary">Cancel</Button>
        <Button loading={loading} onClick={onConfirm} variant={variant}>{confirmText}</Button>
      </div>
    </Modal>
  );
}
