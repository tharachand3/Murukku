import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { Money } from './Money.jsx';
import { Modal } from './Modal.jsx';
import { Pagination } from './Pagination.jsx';
import { QtyStepper } from './QtyStepper.jsx';
import { formatPaise } from '../../lib/money.js';

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
});
