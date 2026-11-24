const IST_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MINUTES = 5 * 60 + 30;

const istCalendarDate = new Intl.DateTimeFormat('en-US', {
  timeZone: IST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function assertValidDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('date must be a valid Date');
  }
}

function istMidnightUtc(year) {
  return new Date(
    Date.UTC(year, 3, 1) - IST_OFFSET_MINUTES * 60 * 1000
  );
}

export function financialYearOf(date) {
  assertValidDate(date);
  const parts = Object.fromEntries(
    istCalendarDate.formatToParts(date).map(({ type, value }) => [type, value])
  );
  const calendarYear = Number(parts.year);
  const month = Number(parts.month);
  const startYear = month >= 4 ? calendarYear : calendarYear - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

export function financialYearRange(fy) {
  const match = typeof fy === 'string' ? /^(\d{4})-(\d{2})$/.exec(fy) : null;
  if (!match) {
    throw new TypeError('fy must use YYYY-YY format');
  }

  const startYear = Number(match[1]);
  const endYear = startYear + 1;
  if (
    startYear < 1000 ||
    startYear > 9998 ||
    Number(match[2]) !== endYear % 100
  ) {
    throw new RangeError('fy must be a valid April-to-March financial year');
  }

  return {
    start: istMidnightUtc(startYear),
    end: istMidnightUtc(endYear)
  };
}

export function currentFinancialYear() {
  return financialYearOf(new Date());
}
