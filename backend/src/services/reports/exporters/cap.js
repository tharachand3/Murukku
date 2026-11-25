import { AppError } from '../../../lib/errors.js';

export const MAX_EXPORT_ROWS = 50000;

export function assertExportRowCap(count) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError('Export row count must be a non-negative safe integer');
  }
  if (count > MAX_EXPORT_ROWS) {
    throw new AppError(422, 'TOO_MANY_ROWS', 'Report sections cannot exceed 50000 rows');
  }
}
