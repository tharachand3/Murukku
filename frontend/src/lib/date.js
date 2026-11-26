const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST = 'Asia/Kolkata';

function asDate(value) {
  const date = value instanceof Date
    ? new Date(value.getTime())
    : new Date(
      typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00+05:30`
        : value
    );
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid date');
  }
  return date;
}

export function todayIST(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(asDate(now));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateParts(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return { day, month, year };
  }
  const date = asDate(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
}

export function formatDateIST(isoOrDate) {
  const { day, month, year } = dateParts(isoOrDate);
  return `${day}-${MONTHS[Number(month) - 1]}-${year}`;
}

export function formatDateTimeIST(isoOrDate) {
  const date = asDate(isoOrDate);
  const { day, month, year } = dateParts(date);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
  return `${day}-${MONTHS[Number(month) - 1]}-${year} ${time}`;
}

export function addDays(dateStr, amount) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    || !Number.isInteger(amount)) {
    throw new TypeError('Expected a YYYY-MM-DD date and an integer day offset');
  }
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateStr) {
    throw new RangeError('Invalid calendar date');
  }
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function rangePreset(name, now = new Date()) {
  const today = todayIST(now);
  const [yearText, monthText] = today.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (name === 'today') {
    return { from: today, to: today };
  }
  if (name === 'last7') {
    return { from: addDays(today, -6), to: today };
  }
  if (name === 'thisMonth') {
    return { from: `${yearText}-${monthText}-01`, to: today };
  }
  if (name === 'lastMonth') {
    const lastMonthEnd = addDays(`${yearText}-${monthText}-01`, -1);
    const [lastYear, lastMonth] = lastMonthEnd.split('-');
    return { from: `${lastYear}-${lastMonth}-01`, to: lastMonthEnd };
  }
  if (name === 'thisFY') {
    const startYear = month >= 4 ? year : year - 1;
    return { from: `${startYear}-04-01`, to: today };
  }
  throw new RangeError(`Unknown date range preset: ${name}`);
}
