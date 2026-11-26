import { formatDateIST } from './date.js';
import { formatBp, formatPaise, formatPaiseDecimal } from './money.js';

function formatIndianInteger(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^-?\d+$/.test(value))) {
    throw new TypeError('Integer report value must be an integer');
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new TypeError('Integer report value must be a safe integer');
  }
  const amount = BigInt(value);
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString();
  const grouped = digits.length <= 3
    ? digits
    : `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${digits.slice(-3)}`;
  return `${negative ? '-' : ''}${grouped}`;
}

export function formatCellDisplay(value, type) {
  if (value === null || value === undefined) {
    return '-';
  }
  if (type === 'money') {
    return formatPaise(value);
  }
  if (type === 'moneyDecimal') {
    return formatPaiseDecimal(value);
  }
  if (type === 'percentBp') {
    return formatBp(value);
  }
  if (type === 'int') {
    return formatIndianInteger(value);
  }
  if (type === 'date') {
    return formatDateIST(value);
  }
  if (type === 'decimal' || type === 'text') {
    return value;
  }
  throw new TypeError(`Unsupported report column type: ${type}`);
}

export function cellTone(column, value) {
  if (value === 'YES' || value === 'MISMATCH') {
    return 'danger';
  }
  const key = String(column?.key ?? '').toLowerCase();
  if (column?.type === 'percentBp' && key.includes('variance')
    && Number.isSafeInteger(value) && value < 0) {
    return 'danger';
  }
  return null;
}
