import { PrismaClient } from '@prisma/client';

export const db = new PrismaClient();

function assertTestDatabase() {
  if (
    !process.env.DATABASE_URL_TEST ||
    process.env.DATABASE_URL !== process.env.DATABASE_URL_TEST
  ) {
    throw new Error('Test database operations are restricted to DATABASE_URL_TEST.');
  }
  const database = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
  if (database !== 'oda_test') {
    throw new Error('Refusing to modify a database other than oda_test.');
  }
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function resetDb() {
  assertTestDatabase();
  await db.$transaction(async (tx) => {
    const tables = await tx.$queryRaw`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename <> '_prisma_migrations'
      ORDER BY tablename
    `;

    if (tables.length > 0) {
      const targets = tables
        .map(({ tablename }) => `${quoteIdentifier('public')}.${quoteIdentifier(tablename)}`)
        .join(', ');
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${targets} RESTART IDENTITY CASCADE`);
    }
  });
}

export async function seedMinimal() {
  assertTestDatabase();
  const units = {};
  for (const unit of [
    { code: 'g', name: 'gram', dimension: 'MASS', baseFactor: 1 },
    { code: 'kg', name: 'kilogram', dimension: 'MASS', baseFactor: 1000 },
    { code: 'pcs', name: 'pieces', dimension: 'COUNT', baseFactor: 1 },
    { code: 'packet', name: 'packet', dimension: 'COUNT', baseFactor: 1 }
  ]) {
    units[unit.code] = await db.unit.create({ data: unit });
  }

  const flour = await db.item.create({
    data: {
      code: 'TEST-FLOUR',
      name: 'Test flour',
      type: 'RAW',
      baseUnitId: units.g.id,
      displayUnitId: units.kg.id
    }
  });
  const finished = await db.item.create({
    data: {
      code: 'TEST-PACKET',
      name: 'Test packet',
      type: 'FINISHED',
      baseUnitId: units.packet.id,
      displayUnitId: units.packet.id
    }
  });

  const admin = await db.user.create({
    data: {
      name: 'Ledger Admin',
      email: 'ledger-admin@test.invalid',
      passwordHash: 'test-only',
      role: 'ADMIN'
    }
  });
  const accountant = await db.user.create({
    data: {
      name: 'Ledger Accountant',
      email: 'ledger-accountant@test.invalid',
      passwordHash: 'test-only',
      role: 'ACCOUNTANT'
    }
  });

  return { units, items: { flour, finished }, users: { admin, accountant } };
}
