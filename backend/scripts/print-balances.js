import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { formatQty } from '../src/lib/units.js';

async function printBalances() {
  const prisma = new PrismaClient();
  try {
    const [items, groupedMovements] = await Promise.all([
      prisma.item.findMany({
        include: { displayUnit: true },
        orderBy: { code: 'asc' }
      }),
      prisma.stockMovement.groupBy({
        by: ['itemId'],
        _sum: { qtyChange: true }
      })
    ]);
    const balanceByItemId = new Map(
      groupedMovements.map(({ itemId, _sum }) => [itemId, _sum.qtyChange ?? 0])
    );

    console.log('Stock balances (display units):');
    for (const item of items) {
      const baseQty = balanceByItemId.get(item.id) ?? 0;
      console.log(`${item.code} (${item.name}): ${formatQty(baseQty, item.displayUnit.code)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

printBalances().catch((error) => {
  console.error('Could not print stock balances:', error);
  process.exitCode = 1;
});
