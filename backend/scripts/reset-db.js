import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seed } from '../prisma/seed.js';

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function resetDatabase() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset the database when NODE_ENV=production.');
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(
      async (tx) => {
        const tables = await tx.$queryRaw`
          SELECT tablename
          FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename <> '_prisma_migrations'
          ORDER BY tablename
        `;
        if (tables.length > 0) {
          // Keep Prisma's migration history while resetting application data.
          const targets = tables
            .map(({ tablename }) => `${quoteIdentifier('public')}.${quoteIdentifier(tablename)}`)
            .join(', ');
          await tx.$executeRawUnsafe(
            `TRUNCATE TABLE ${targets} RESTART IDENTITY CASCADE`
          );
        }

        await seed(tx);
      },
      { timeout: 60000 }
    );
    console.log('Application tables reset and benchmark data seeded.');
  } finally {
    await prisma.$disconnect();
  }
}

resetDatabase().catch((error) => {
  console.error('Database reset failed:', error);
  process.exitCode = 1;
});
