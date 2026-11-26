import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlertCard } from './AlertCard.jsx';
import { FlagChip } from './FlagChip.jsx';
import { LowStockChip } from './LowStockChip.jsx';

describe('alert components', () => {
  it('shows a Low chip only when an integer balance is at or below its level', () => {
    const { rerender } = render(<LowStockChip balanceBase={100} reorderLevelBase={100} />);
    expect(screen.getByRole('status', { name: 'Low stock' })).toHaveTextContent('Low');

    rerender(<LowStockChip balanceBase={101} reorderLevelBase={100} />);
    expect(screen.queryByRole('status', { name: 'Low stock' })).not.toBeInTheDocument();

    rerender(<LowStockChip balanceBase={100} reorderLevelBase={null} />);
    expect(screen.queryByRole('status', { name: 'Low stock' })).not.toBeInTheDocument();
  });

  it('renders the accessible flagged chip', () => {
    render(<FlagChip />);
    expect(screen.getByRole('status', { name: 'Flagged production variance' }))
      .toHaveTextContent('Flagged');
  });

  it('uses an alert role only for danger cards', () => {
    const { rerender } = render(<AlertCard tone="danger" title="Yield">Yield is low.</AlertCard>);
    expect(screen.getByRole('alert')).toHaveTextContent('Yield is low.');

    rerender(<AlertCard tone="warning" title="Stock">Stock is low.</AlertCard>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
