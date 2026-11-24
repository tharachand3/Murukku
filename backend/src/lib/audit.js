import { Prisma } from '@prisma/client';

function toJsonValue(value) {
  const serialized = JSON.stringify(value, (_key, nestedValue) => {
    if (typeof nestedValue === 'bigint') {
      return nestedValue.toString();
    }
    if (nestedValue instanceof Date) {
      return nestedValue.toISOString();
    }
    return nestedValue;
  });

  return serialized === undefined ? undefined : JSON.parse(serialized);
}

export async function writeAudit(
  db,
  { userId, action, entity, entityId, before, after }
) {
  // Pass the transaction client (`tx`) to keep the audit row atomic with its data change.
  const data = {
    userId: userId ?? null,
    action,
    entity,
    entityId: entityId ?? null
  };

  for (const [key, value] of Object.entries({ before, after })) {
    const jsonValue = toJsonValue(value);
    if (jsonValue !== undefined) {
      data[key] = jsonValue === null ? Prisma.JsonNull : jsonValue;
    }
  }

  return db.auditLog.create({ data });
}
