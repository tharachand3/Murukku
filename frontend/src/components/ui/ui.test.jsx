import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectStableTyping } from '../../test/remountGuard.js';
import { Button } from './Button.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { Money } from './Money.jsx';
import { Modal } from './Modal.jsx';
import { Pagination } from './Pagination.jsx';
import { QtyStepper } from './QtyStepper.jsx';
import { StatusBadge } from './StatusBadge.jsx';
import { Table } from './Table.jsx';
import { Skeleton } from './Skeleton.jsx';
import { formatPaise } from '../../lib/money.js';
import { STATUS_LABELS } from '../../lib/statusLabels.js';

function EditableModal() {
  const [value, setValue] = useState('');
  return (
    <Modal open title="Details" onClose={() => {}}>
      <input
        aria-label="Modal text"
        onChange={(event) => setValue(event.target.value)}
        value={value}
      />
    </Modal>
  );
}

function QuantityHarness() {
  const [value, setValue] = useState(0);
  return <QtyStepper value={value} max={100} onChange={setValue} />;
}

function OpenableModal() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">Open details</button>
      <Modal open={open} title="Details" onClose={() => setOpen(false)}>
        <button onClick={() => setOpen(false)} type="button">Close details</button>
      </Modal>
    </>
  );
}

describe('UI primitives', () => {
  it('renders formatted money from integer paise', () => {
    render(<Money paise={787500} />);
    expect(screen.getByText('Rs 7,875.00')).toHaveClass('tabular-nums');
    expect(() => formatPaise(1.5)).toThrow();
  });

  it('disables a loading action and shows a spinner', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(screen.getByRole('status', { name: 'Working' })).toBeInTheDocument();
  });

  it('uses the documented label for each workflow status and retains its raw code', () => {
    render(<div>{Object.entries(STATUS_LABELS).map(([status, label]) => <StatusBadge key={status} status={status} />)}</div>);
    for (const [status, label] of Object.entries(STATUS_LABELS)) {
      expect(screen.getByText(label)).toHaveAttribute('title', status);
    }
  });

  it('renders responsive table labels and the table skeleton state', () => {
    const { rerender } = render(<Table columns={[{ key: 'name', label: 'Item' }]} responsive rows={[{ id: 'flour', name: 'Flour' }]} />);
    expect(screen.getByRole('table')).toHaveClass('responsive-table');
    expect(screen.getByRole('cell', { name: 'Flour' })).toHaveAttribute('data-label', 'Item');
    rerender(<Skeleton variant="table" rows={2} />);
    expect(screen.getByRole('status', { name: 'Loading table' })).toBeInTheDocument();
  });

  it('bounds pagination controls and emits selected pages', async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    render(<Pagination page={2} pages={3} onPage={onPage} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(3);
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('moves focus into the modal and closes it with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open title="Details" onClose={onClose}><button type="button">Inside</button></Modal>);
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(dialog).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the opener after a modal closes', async () => {
    const user = userEvent.setup();
    render(<OpenableModal />);
    const opener = screen.getByRole('button', { name: 'Open details' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Details' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  it('keeps focus in a modal field while its owner rerenders on every keystroke', async () => {
    const user = userEvent.setup();
    render(<EditableModal />);
    await expectStableTyping(user, () => screen.getByRole('textbox', { name: 'Modal text' }), 'stable');
  });

  it('renders confirmation actions', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        message="Remove this row?"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('clamps the typed and stepped quantity to min and max', async () => {
    const user = userEvent.setup();
    let value = 2;
    const onChange = vi.fn((next) => {
      value = next;
    });
    const { rerender } = render(<QtyStepper value={value} min={1} max={3} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Decrease Quantity' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    value = 1;
    rerender(<QtyStepper value={value} min={1} max={3} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Decrease Quantity' })).toBeDisabled();

    const input = screen.getByRole('textbox', { name: 'Quantity' });
    await user.clear(input);
    await user.type(input, '99');
    expect(onChange).toHaveBeenLastCalledWith(3);
  });

  it('keeps the typed quantity draft unchanged until the field blurs', async () => {
    const user = userEvent.setup();
    render(<QuantityHarness />);
    const input = screen.getByRole('textbox', { name: 'Quantity' });
    await user.clear(input);
    await expectStableTyping(user, () => screen.getByRole('textbox', { name: 'Quantity' }), '01');
    await user.tab();
    expect(input).toHaveValue('1');
  });

  it('preserves a quantity selection during edits and does not wheel-step it', async () => {
    const user = userEvent.setup();
    render(<QuantityHarness />);
    const input = screen.getByRole('textbox', { name: 'Quantity' });
    await user.clear(input);
    await user.type(input, '123');
    input.setSelectionRange(1, 2);
    await user.keyboard('9');

    expect(input).toHaveValue('193');
    expect(input.selectionStart).toBe(2);
    fireEvent.wheel(input);
    expect(input).toHaveValue('193');
  });
});
