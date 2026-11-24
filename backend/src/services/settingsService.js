import { prisma } from '../lib/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { STATES } from '../lib/states.js';

export const SETTING_KEYS = Object.freeze([
  'COMPANY_NAME',
  'COMPANY_GSTIN',
  'COMPANY_STATE_CODE',
  'COMPANY_ADDRESS',
  'VARIANCE_TOLERANCE_BP',
  'FY_START_MONTH'
]);

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function validateValue(key, value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest('value must be a non-empty string');
  }
  const normalized = value.trim();

  if (key === 'COMPANY_GSTIN') {
    const gstin = normalized.toUpperCase();
    if (!GSTIN_PATTERN.test(gstin)) {
      throw badRequest('COMPANY_GSTIN must be a valid 15-character GSTIN');
    }
    return gstin;
  }
  if (key === 'COMPANY_STATE_CODE' && !Object.hasOwn(STATES, normalized)) {
    throw badRequest('COMPANY_STATE_CODE must be a supported state code');
  }
  if (key === 'VARIANCE_TOLERANCE_BP') {
    if (!/^\d+$/.test(normalized) || Number(normalized) > 5000) {
      throw badRequest('VARIANCE_TOLERANCE_BP must be an integer from 0 to 5000');
    }
  }
  if (key === 'FY_START_MONTH' && normalized !== '4') {
    throw badRequest('FY_START_MONTH is fixed at 4');
  }
  return normalized;
}

export async function getSettings(db) {
  const settings = await db.setting.findMany({ orderBy: { key: 'asc' } });
  return Object.fromEntries(settings.map(({ key, value }) => [key, value]));
}

export async function putSetting(userId, key, value) {
  if (!SETTING_KEYS.includes(key)) {
    throw badRequest('Setting key is not editable');
  }
  const normalizedValue = validateValue(key, value);

  return prisma.$transaction(async (tx) => {
    const before = await tx.setting.findUnique({ where: { key } });
    const after = await tx.setting.upsert({
      where: { key },
      update: { value: normalizedValue },
      create: { key, value: normalizedValue }
    });
    await writeAudit(tx, {
      userId,
      action: before ? 'UPDATE' : 'CREATE',
      entity: 'Setting',
      entityId: null,
      before,
      after
    });
    return after;
  });
}
