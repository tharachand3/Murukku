import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './ToastContext.jsx';

function ToastButtons() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.info('One')} type="button">One</button>
      <button onClick={() => toast.success('Two')} type="button">Two</button>
      <button onClick={() => toast.error('Three')} type="button">Three</button>
      <button onClick={() => toast.info('Four')} type="button">Four</button>
    </>
  );
}

describe('toast notifications', () => {
  it('keeps at most three visible and dismisses after four seconds', async () => {
    vi.useFakeTimers();
    render(<ToastProvider><ToastButtons /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Three' }));
    fireEvent.click(screen.getByRole('button', { name: 'Four' }));
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(screen.queryByRole('status', { name: 'One' })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryAllByRole('status')).toHaveLength(0);
    vi.useRealTimers();
  });
});
