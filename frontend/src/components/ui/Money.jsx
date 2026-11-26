import { formatPaise } from '../../lib/money.js';

// Right-aligned, tabular display for integer paise amounts.
export function Money({ paise, className = '' }) {
  return (
    <span className={`block text-right tabular-nums ${className}`}>{formatPaise(paise)}</span>
  );
}
