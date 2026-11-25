import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { getAverageRate } from '../src/services/costingService.js';
import { getBalances } from '../src/services/ledgerService.js';
import { formatQty } from '../src/lib/units.js';
import { computeRunVariance } from '../src/services/varianceService.js';

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
  'after-issue': {
    stock: {
      FLOUR: '120 kg',
      OIL: '19.5 l',
      SPICE: '3.8 kg',
      POUCH200: '500 pcs',
      CARTON: '30 pcs',
      MURUKKU200: '50 packet'
    },
    documents: { startedProductionRuns: 1 }
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
    documents: { completedProductionRuns: 1 },
    completedRun: { actualGoodQty: 188 }
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
    documents: { payments: 1 },
    varianceChecks: [
      { name: 'yield variance -6.00% flagged', target: 'yield', expected: { bp: -600, pct: '-6.00', flagged: true } },
      { name: 'oil variance +5.00% flagged', itemCode: 'OIL', expected: { bp: 500, pct: '5.00', flagged: true } },
      { name: 'flour variance 0.00% not flagged', itemCode: 'FLOUR', expected: { bp: 0, pct: '0.00', flagged: false } },
      { name: 'spice variance 0.00% not flagged', itemCode: 'SPICE', expected: { bp: 0, pct: '0.00', flagged: false } }
    ],
    varianceInfo: [
      { name: 'carton variance (informational)', itemCode: 'CARTON' },
      { name: 'pouch variance (informational)', itemCode: 'POUCH200' }
    ]
  }
};

const STAGES = Object.keys(EXPECTED);
const DOCUMENT_READERS = {
  purchases: (db) => db.purchase.count(),
  startedProductionRuns: (db) => db.productionRun.count(),
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
  ...(expectations.completedRun
    ? [{
        name: `run COMPLETED with actualGoodQty ${expectations.completedRun.actualGoodQty}`,
        kind: 'document',
        stage,
        expected: true,
        actualFn: async (db) => Boolean(await db.productionRun.findFirst({
          where: {
            status: 'COMPLETED',
            actualGoodQty: expectations.completedRun.actualGoodQty
          },
          select: { id: true }
        }))
      }]
    : []),
  ...(expectations.varianceChecks ?? []).map((expectation) => ({
    name: expectation.name,
    kind: 'document',
    stage,
    expected: JSON.stringify(expectation.expected),
    actualFn: async (db) => {
      const run = await db.productionRun.findFirst({
        where: { status: 'COMPLETED', actualGoodQty: 188 },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        include: {
          lines: {
            include: {
              item: {
                select: {
                  code: true,
                  name: true,
                  displayUnit: { select: { code: true } }
                }
              }
            }
          }
        }
      });
      if (!run) {
        return null;
      }
      const variance = computeRunVariance(run, run.lines);
      const result = expectation.target === 'yield'
        ? variance.yield
        : variance.lines.find((line) =>
            run.lines.find((runLine) => runLine.itemId === line.itemId)?.item.code === expectation.itemCode
          );
      if (!result) {
        return null;
      }
      return JSON.stringify({
        bp: result.bp,
        pct: result.pct,
        flagged: result.flagged
      });
    }
  })),
  ...(expectations.varianceInfo ?? []).map((expectation) => ({
    name: expectation.name,
    kind: 'info',
    stage,
    expected: 'informational; not asserted',
    actualFn: async (db) => {
      const run = await db.productionRun.findFirst({
        where: { status: 'COMPLETED', actualGoodQty: 188 },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        include: {
          lines: {
            include: {
              item: {
                select: {
                  code: true,
                  name: true,
                  displayUnit: { select: { code: true } }
                }
              }
            }
          }
        }
      });
      if (!run) {
        return 'benchmark run not found';
      }
      const variance = computeRunVariance(run, run.lines);
      const line = variance.lines.find((entry) =>
        run.lines.find((runLine) => runLine.itemId === entry.itemId)?.item.code === expectation.itemCode
      );
      if (!line) {
        return `${expectation.itemCode} variance not found`;
      }
      return `${line.pct}% ${line.flagged ? 'flagged' : 'not flagged'}`;
    }
  })),
  ...Object.entries(expectations.documents).map(([document, expected]) => ({
    name: `${document} count`,
    kind: 'document',
    stage,
    expected,
    actualFn: DOCUMENT_READERS[document]
  }))
]);

checks.push(...['opening', 'after-purchase', 'after-issue', 'after-run'].map((stage) => ({
  name: 'ledger reconciles: SUM(qtyChange) per item equals the displayed balance',
  kind: 'document',
  stage,
  expected: true,
  actualFn: async (db) => {
    const [balances, totals] = await Promise.all([
      getBalances(db),
      db.stockMovement.groupBy({
        by: ['itemId'],
        _sum: { qtyChange: true }
      })
    ]);
    const totalByItemId = new Map(
      totals.map(({ itemId, _sum }) => [itemId, _sum.qtyChange ?? 0])
    );
    return balances.every(({ itemId, balanceBase, balanceDisplay, displayUnit }) => {
      const ledgerTotal = totalByItemId.get(itemId) ?? 0;
      return ledgerTotal === balanceBase &&
        formatQty(ledgerTotal, displayUnit) === balanceDisplay;
    });
  }
})));

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
        const status = check.kind === 'info'
          ? 'INFO'
          : actual === check.expected ? 'PASS' : 'FAIL';
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
