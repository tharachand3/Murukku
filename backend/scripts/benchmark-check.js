import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { getAverageRate } from '../src/services/costingService.js';
import { getBalances } from '../src/services/ledgerService.js';

const EXPECTED = {
  opening: {
    stock: {
      FLOUR: '100 kg',
      OIL: '30 l',
      SPICE: '5 kg',
      POUCH200: '500 pcs',
      CARTON: '30 pcs',
      MURUKKU200: '50 packet'
    },
    documents: {}
  },
  'after-purchase': {
    stock: { FLOUR: '160 kg' },
    documents: { purchases: 1 },
    purchaseLine: {
      itemCode: 'FLOUR',
      qtyBase: 60000,
      ratePaisePerBase: '4.5',
      amountPaise: 270000
    },
    averageRate: {
      itemCode: 'FLOUR',
      paisePerBase: '4.3125'
    }
  },
  'after-run': {
    stock: {
      FLOUR: '120 kg',
      OIL: '19.5 l',
      SPICE: '3.8 kg',
      POUCH200: '306 pcs',
      CARTON: '21 pcs',
      MURUKKU200: '238 packet'
    },
    documents: { completedProductionRuns: 1 }
  },
  'after-dispatch': {
    stock: { MURUKKU200: '88 packet' },
    documents: {
      postedInvoices: 1,
      dispatches: 1
    }
  },
  final: {
    stock: { MURUKKU200: '88 packet' },
    documents: { payments: 1 }
  }
};

const STAGES = Object.keys(EXPECTED);
const DOCUMENT_READERS = {
  purchases: (db) => db.purchase.count(),
  completedProductionRuns: (db) => db.productionRun.count({
    where: { status: 'COMPLETED' }
  }),
  postedInvoices: (db) => db.invoice.count({ where: { status: 'POSTED' } }),
  dispatches: (db) => db.dispatch.count(),
  payments: (db) => db.payment.count()
};

const checks = Object.entries(EXPECTED).flatMap(([stage, expectations]) => [
  ...Object.entries(expectations.stock).map(([itemCode, expected]) => ({
    name: `${itemCode} balance`,
    kind: 'stock',
    stage,
    expected,
    actualFn: async (db) => {
      const item = await db.item.findUnique({
        where: { code: itemCode },
        select: { id: true }
      });
      if (!item) {
        return null;
      }
      const [balance] = await getBalances(db, { itemIds: [item.id] });
      return balance?.balanceDisplay ?? null;
    }
  })),
  ...(expectations.purchaseLine
    ? [{
        name: 'FLOUR purchase: 60 kg at Rs 45/kg',
        kind: 'document',
        stage,
        expected: true,
        actualFn: async (db) => {
          const lines = await db.purchaseLine.findMany({
            where: {
              item: { code: expectations.purchaseLine.itemCode },
              qty: expectations.purchaseLine.qtyBase,
              amountPaise: expectations.purchaseLine.amountPaise
            },
            select: { ratePaisePerBase: true }
          });
          return lines.some(({ ratePaisePerBase }) =>
            ratePaisePerBase.toString() === expectations.purchaseLine.ratePaisePerBase
          );
        }
      }]
    : []),
  ...(expectations.averageRate
    ? [{
        name: 'FLOUR weighted average rate',
        kind: 'document',
        stage,
        expected: expectations.averageRate.paisePerBase,
        actualFn: async (db) => {
          const item = await db.item.findUnique({
            where: { code: expectations.averageRate.itemCode },
            select: { id: true }
          });
          if (!item) {
            return null;
          }
          return (await getAverageRate(db, item.id)).toString();
        }
      }]
    : []),
  ...Object.entries(expectations.documents).map(([document, expected]) => ({
    name: `${document} count`,
    kind: 'document',
    stage,
    expected,
    actualFn: DOCUMENT_READERS[document]
  }))
]);

function readStage(args) {
  const stageArgument = args.find((argument) => argument.startsWith('--stage='));
  const stage = stageArgument?.slice('--stage='.length);
  if (!STAGES.includes(stage)) {
    throw new Error(`Use --stage=${STAGES.join('|')}`);
  }
  return stage;
}

async function main() {
  let stage;
  try {
    stage = readStage(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const selectedStageIndex = STAGES.indexOf(stage);
  const prisma = new PrismaClient();
  let failures = 0;
  let passed = 0;
  let skipped = 0;

  try {
    const results = [];
    for (const check of checks) {
      const isCurrentStockStage = check.kind !== 'stock' || check.stage === stage;
      const isReachedStage = STAGES.indexOf(check.stage) <= selectedStageIndex;
      if (!isCurrentStockStage || !isReachedStage) {
        skipped += 1;
        results.push({
          Check: check.name,
          Stage: check.stage,
          Status: 'SKIPPED',
          Expected: check.expected,
          Actual: 'not applicable yet'
        });
        continue;
      }

      try {
        const actual = await check.actualFn(prisma);
        const status = actual === check.expected ? 'PASS' : 'FAIL';
        if (status === 'PASS') {
          passed += 1;
        } else {
          failures += 1;
        }
        results.push({
          Check: check.name,
          Stage: check.stage,
          Status: status,
          Expected: check.expected,
          Actual: actual
        });
      } catch (error) {
        failures += 1;
        results.push({
          Check: check.name,
          Stage: check.stage,
          Status: 'FAIL',
          Expected: check.expected,
          Actual: `ERROR: ${error.message}`
        });
      }
    }

    console.log(`Benchmark stage: ${stage}`);
    console.table(results);
    console.log(`PASS: ${passed} | FAIL: ${failures} | SKIPPED: ${skipped}`);
    if (failures > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
