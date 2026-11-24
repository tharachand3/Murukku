import { AppError } from '../lib/errors.js';
import { financialYearOf } from '../lib/fy.js';

const ALLOWED_PREFIXES = new Set([
  'INV',
  'PUR',
  'RUN',
  'ORD',
  'DSP',
  'RCT',
  'CN',
  'ADJ'
]);

export async function nextNumber(db, prefix, date = new Date()) {
  if (!ALLOWED_PREFIXES.has(prefix)) {
    throw new AppError(500, 'INVALID_DOCUMENT_PREFIX', 'Unsupported document number prefix');
  }

  const key = `${prefix}:${financialYearOf(date)}`;
  const [counter] = await db.$queryRaw`
    INSERT INTO "DocumentCounter" ("key", "lastNumber")
    VALUES (${key}, 1)
    ON CONFLICT ("key")
    DO UPDATE SET "lastNumber" = "DocumentCounter"."lastNumber" + 1
    RETURNING "lastNumber"
  `;

  if (!counter || !Number.isSafeInteger(counter.lastNumber) || counter.lastNumber < 1) {
    throw new RangeError('Document counter returned an invalid number');
  }

  return `${prefix}/${key.slice(prefix.length + 1)}/${String(counter.lastNumber).padStart(4, '0')}`;
}
