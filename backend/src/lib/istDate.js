const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function isValidIstDate(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ][month - 1];
  return daysInMonth !== undefined && day >= 1 && day <= daysInMonth;
}

function parseCalendarDate(value) {
  if (!isValidIstDate(value)) {
    throw new TypeError('Date must be a valid YYYY-MM-DD calendar day');
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const [, yearText, monthText, dayText] = match;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(yearText), Number(monthText) - 1, Number(dayText));
  return date;
}

function istMidnightUtc(date) {
  return new Date(date.getTime() - IST_OFFSET_MS);
}

export function istDayRange(fromStr, toStr) {
  const fromDate = fromStr === undefined ? undefined : parseCalendarDate(fromStr);
  const toDate = toStr === undefined ? undefined : parseCalendarDate(toStr);

  if (fromDate && toDate && fromDate > toDate) {
    throw new RangeError('from must be earlier than or equal to to');
  }

  const gte = fromDate ? istMidnightUtc(fromDate) : undefined;
  if (toDate) {
    toDate.setUTCDate(toDate.getUTCDate() + 1);
  }
  const lt = toDate ? istMidnightUtc(toDate) : undefined;

  return { gte, lt };
}
