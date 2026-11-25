import Decimal from 'decimal.js';
import { paiseToRupeesString } from './money.js';

const DecimalExport = Decimal.clone({ precision: 40 });

function assertInteger(value, name) {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  return BigInt(value);
}

function twoDecimalRupeesFromPaise(value) {
  const paise = assertInteger(value, 'Money');
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function formatPercent(value) {
  const bp = assertInteger(value, 'Basis points');
  const negative = bp < 0n;
  const absolute = negative ? -bp : bp;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function safeText(value) {
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function formatCell(value, type) {
  if (value === null || value === undefined) {
    return '';
  }
  switch (type) {
    case 'text':
      return safeText(value);
    case 'date':
    case 'decimal':
      return String(value);
    case 'int':
      return String(assertInteger(value, 'Integer'));
    case 'money':
      return twoDecimalRupeesFromPaise(value);
    case 'moneyDecimal':
      return new DecimalExport(value)
        .div(100)
        .toDecimalPlaces(2, DecimalExport.ROUND_HALF_UP)
        .toFixed(2);
    case 'percentBp':
      return formatPercent(value);
    default:
      throw new TypeError(`Unsupported export cell type: ${type}`);
  }
}

export function formatCellDisplay(value, type) {
  if (value === null || value === undefined) {
    return '';
  }
  if (type === 'money') {
    const paise = assertInteger(value, 'Money');
    return paiseToRupeesString(paise.toString());
  }
  if (type === 'percentBp') {
    return `${formatPercent(value)}%`;
  }
  if (type === 'text') {
    return String(value);
  }
  return formatCell(value, type);
}

export function excelValue(value, type) {
  if (value === null || value === undefined) {
    return { value: null, numFmt: undefined };
  }
  switch (type) {
    case 'money':
    case 'moneyDecimal':
      return {
        value: Number(formatCell(value, type)),
        numFmt: '#,##0.00'
      };
    case 'int':
      return {
        value: Number(assertInteger(value, 'Integer')),
        numFmt: '#,##0'
      };
    case 'percentBp':
      return {
        value: Number(assertInteger(value, 'Basis points')) / 10000,
        numFmt: '0.00%'
      };
    case 'decimal': {
      const text = String(value);
      const number = Number(text);
      return {
        value: Number.isFinite(number) ? number : text,
        numFmt: undefined
      };
    }
    case 'text':
      return { value: safeText(value), numFmt: undefined };
    case 'date':
      return { value: String(value), numFmt: undefined };
    default:
      throw new TypeError(`Unsupported export cell type: ${type}`);
  }
}
