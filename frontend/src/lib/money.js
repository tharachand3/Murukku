function toIntegerBigInt(value, label) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${label} must be a safe integer`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new TypeError(`${label} must be an integer or integer string`);
}

function groupIndian(value) {
  if (value.length <= 3) {
    return value;
  }
  const lastThree = value.slice(-3);
  const leading = value.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${leading},${lastThree}`;
}

function moneyText(rupees, paise, negative) {
  const prefix = negative ? '-Rs ' : 'Rs ';
  return `${prefix}${groupIndian(rupees)}.${String(paise).padStart(2, '0')}`;
}

export function formatPaise(paise) {
  const amount = toIntegerBigInt(paise, 'paise');
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  return moneyText(
    (absolute / 100n).toString(),
    Number(absolute % 100n),
    negative && absolute !== 0n
  );
}

export function formatPaiseDecimal(value) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new TypeError('Decimal amount must be a decimal string');
  }
  const negative = value.startsWith('-');
  const [wholeText, fractionText = ''] = (negative ? value.slice(1) : value).split('.');
  let paise = BigInt(wholeText);
  if (Number(fractionText[0] ?? 0) >= 5) {
    paise += 1n;
  }
  const signedPaise = negative ? -paise : paise;
  return formatPaise(signedPaise.toString());
}

function validGrouping(text) {
  if (!text.includes(',')) {
    return /^\d+$/.test(text);
  }
  return /^\d{1,3}(?:,\d{3})+$/.test(text)
    || /^\d{1,2}(?:,\d{2})*,\d{3}$/.test(text);
}

export function parseRupeesToPaise(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Amount must be entered as text');
  }
  const trimmed = text.trim();
  const match = trimmed.match(/^([\d,]+)(?:\.(\d{1,2}))?$/);
  if (!match || !validGrouping(match[1])) {
    throw new TypeError('Enter a non-negative amount with up to two decimal places');
  }
  const whole = BigInt(match[1].replace(/,/g, ''));
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  const paise = whole * 100n + fraction;
  if (paise > 10000000000n) {
    throw new RangeError('Amount cannot exceed Rs 10,00,00,000');
  }
  return Number(paise);
}

export function paiseToInput(paise) {
  const amount = toIntegerBigInt(paise, 'paise');
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function formatBp(bp) {
  const amount = toIntegerBigInt(bp, 'basis points');
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  return `${negative && absolute !== 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}%`;
}
