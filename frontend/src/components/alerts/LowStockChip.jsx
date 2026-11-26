import { isLow } from '../../lib/alerts.js';

export function LowStockChip({ balanceBase, reorderLevelBase }) {
  if (!isLow(balanceBase, reorderLevelBase)) {
    return null;
  }
  return (
    <span
      aria-label="Low stock"
      className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800"
      role="status"
    >
      Low
    </span>
  );
}
