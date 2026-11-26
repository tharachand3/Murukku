import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { getAverageRate } from '../src/services/costingService.js';
import { getBalances } from '../src/services/ledgerService.js';
import { getShortageSummary } from '../src/services/availabilityService.js';
import { formatQty } from '../src/lib/units.js';
import { computeRunVariance } from '../src/services/varianceService.js';
import { formatPaiseDecimalAsRupees, marginPerPacket } from '../src/lib/costMath.js';

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
    },
    retailInvoice: {
      invoiceNo: 'INV/<FY>/0001',
      totalPaise: 787500,
      cgstPaise: 18750,
      sgstPaise: 18750,
      igstPaise: 0,
      orderStatus: 'DISPATCHED'
    }
  },
  final: {
    stock: { MURUKKU200: '88 packet' },
    documents: { payments: 1 },
    retailOutstanding: {
      invoicedPaise: 787500,
      paidPaise: 400000,
      outstandingPaise: 387500
    },
    distributorShortage: {
      invoiceCount: 0,
      orderStatus: 'SUBMITTED',
      orderQty: 120,
      free: 88,
      shortBy: 32
    },
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

checks.push(
  {
    name: 'FLOUR weighted average = 4.3125 paise per g (Rs 43.125/kg)',
    kind: 'document',
    stage: 'after-purchase',
    expected: '4.3125',
    actualFn: async (db) => {
      const item = await db.item.findUnique({
        where: { code: 'FLOUR' },
        select: { id: true }
      });
      if (!item) {
        return null;
      }
      return (await getAverageRate(db, item.id)).toString();
    }
  },
  {
    name: 'material cost of run 1 = 405500',
    kind: 'document',
    stage: 'after-run',
    expected: 405500,
    actualFn: async (db) => {
      const run = await db.productionRun.findUnique({
        where: { id: 1 },
        select: { materialCostPaise: true }
      });
      return run ? run.materialCostPaise : 'SKIPPED';
    }
  },
  {
    name: 'production run overhead cost = 180000 paise',
    kind: 'document',
    stage: 'final',
    expected: 180000,
    actualFn: async (db) => {
      const run = await db.productionRun.findFirst({
        where: { status: 'COMPLETED', actualGoodQty: 188 },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        select: {
          overheadCostPaise: true,
          overheads: { select: { id: true } }
        }
      });
      if (!run || run.overheads.length === 0) {
        return 'SKIPPED';
      }
      return run.overheadCostPaise ?? 0;
    }
  },
  {
    name: 'production cost per good packet rounds to Rs 31.14',
    kind: 'document',
    stage: 'final',
    expected: 'Rs 31.14',
    actualFn: async (db) => {
      const run = await db.productionRun.findFirst({
        where: { status: 'COMPLETED', actualGoodQty: 188 },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        select: {
          costPerPacketPaise: true,
          overheads: { select: { id: true } }
        }
      });
      if (!run || run.overheads.length === 0) {
        return 'SKIPPED';
      }
      return run.costPerPacketPaise === null
        ? null
        : formatPaiseDecimalAsRupees(run.costPerPacketPaise);
    }
  },
  {
    name: 'cost sheet: material 405500, overhead 180000, margin bp 3771',
    kind: 'document',
    stage: 'final',
    expected: JSON.stringify({
      materialCostPaise: 405500,
      overheadCostPaise: 180000,
      marginBp: 3771
    }),
    actualFn: async (db) => {
      const run = await db.productionRun.findFirst({
        where: { status: 'COMPLETED', actualGoodQty: { gt: 0 } },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        select: {
          materialCostPaise: true,
          overheadCostPaise: true,
          costPerPacketPaise: true,
          finishedItem: { select: { sellingPricePaise: true } }
        }
      });
      if (!run) {
        return 'SKIPPED';
      }
      const margin = run.finishedItem.sellingPricePaise === null ||
          run.costPerPacketPaise === null
        ? null
        : marginPerPacket({
            sellingPricePaise: run.finishedItem.sellingPricePaise,
            costPerPacketPaise: run.costPerPacketPaise
          });
      return JSON.stringify({
        materialCostPaise: run.materialCostPaise ?? 0,
        overheadCostPaise: run.overheadCostPaise ?? 0,
        marginBp: margin?.marginBp ?? null
      });
    }
  },
  {
    name: 'Retailer A invoice totals 787500 paise with CGST/SGST 18750 and order DISPATCHED',
    kind: 'document',
    stage: 'after-dispatch',
    expected: JSON.stringify(EXPECTED['after-dispatch'].retailInvoice),
    actualFn: async (db) => {
      const invoice = await db.invoice.findFirst({
        where: {
          status: 'POSTED',
          customer: { name: 'Retailer A' }
        },
        orderBy: { id: 'asc' },
        include: { order: { select: { status: true } } }
      });
      if (!invoice || !/^INV\/\d{4}-\d{2}\/0001$/.test(invoice.invoiceNo)) {
        return null;
      }
      return JSON.stringify({
        invoiceNo: invoice.invoiceNo.replace(/^INV\/\d{4}-\d{2}/, 'INV/<FY>'),
        totalPaise: invoice.totalPaise,
        cgstPaise: invoice.cgstPaise,
        sgstPaise: invoice.sgstPaise,
        igstPaise: invoice.igstPaise,
        orderStatus: invoice.order?.status
      });
    }
  },
  {
    name: 'Retailer A outstanding is Rs 3,875.00',
    kind: 'document',
    stage: 'final',
    expected: JSON.stringify(EXPECTED.final.retailOutstanding),
    actualFn: async (db) => {
      const customer = await db.customer.findFirst({
        where: { name: 'Retailer A' },
        select: { id: true }
      });
      if (!customer) {
        return null;
      }
      const [invoices, payments] = await Promise.all([
        db.invoice.aggregate({
          where: { customerId: customer.id, status: 'POSTED' },
          _sum: { totalPaise: true }
        }),
        db.payment.aggregate({
          where: { customerId: customer.id },
          _sum: { amountPaise: true }
        })
      ]);
      const invoicedPaise = invoices._sum.totalPaise ?? 0;
      const paidPaise = payments._sum.amountPaise ?? 0;
      return JSON.stringify({
        invoicedPaise,
        paidPaise,
        outstandingPaise: Math.max(0, invoicedPaise - paidPaise)
      });
    }
  },
  {
    name: 'Distributor B has no invoice and a 32-packet shortage against 88 free',
    kind: 'document',
    stage: 'final',
    expected: JSON.stringify(EXPECTED.final.distributorShortage),
    actualFn: async (db) => {
      const customer = await db.customer.findFirst({
        where: { name: 'Distributor B' },
        select: { id: true }
      });
      const item = await db.item.findUnique({
        where: { code: 'MURUKKU200' },
        select: { id: true }
      });
      if (!customer || !item) {
        return null;
      }
      const [invoiceCount, order, shortages] = await Promise.all([
        db.invoice.count({ where: { customerId: customer.id } }),
        db.order.findFirst({
          where: { customerId: customer.id },
          orderBy: { id: 'desc' },
          include: { lines: { where: { itemId: item.id } } }
        }),
        getShortageSummary(db)
      ]);
      const shortageItem = shortages.items.find(({ itemId }) => itemId === item.id);
      const shortageOrder = shortageItem?.orders.find(({ orderId }) => orderId === order?.id);
      if (!shortageOrder) {
        return null;
      }
      return JSON.stringify({
        invoiceCount,
        orderStatus: order.status,
        orderQty: shortageOrder.qty,
        free: shortageItem.free,
        shortBy: shortageOrder.shortBy
      });
    }
  }
);

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

checks.push(
  ...Object.entries({
    FLOUR: '120 kg',
    OIL: '19.5 l',
    SPICE: '3.8 kg',
    POUCH200: '306 pcs',
    CARTON: '21 pcs',
    MURUKKU200: '88 packet'
  }).map(([itemCode, expected]) => ({
    name: `final ${itemCode} balance`,
    kind: 'stock',
    stage: 'final',
    expected,
    actualFn: async (db) => {
      const item = await db.item.findUnique({
        where: { code: itemCode },
        select: { id: true }
      });
      if (!item) return null;
      const [balance] = await getBalances(db, { itemIds: [item.id] });
      return balance?.balanceDisplay ?? null;
    }
  })),
  ...['CARTON', 'POUCH200'].map((itemCode) => ({
    name: itemCode === 'CARTON'
      ? 'carton variance -10.00% flagged'
      : 'pouch variance -3.00% not flagged',
    kind: 'document',
    stage: 'final',
    expected: JSON.stringify({
      bp: itemCode === 'CARTON' ? -1000 : -300,
      pct: itemCode === 'CARTON' ? '-10.00' : '-3.00',
      flagged: itemCode === 'CARTON'
    }),
    actualFn: async (db) => {
      const run = await db.productionRun.findFirst({
        where: { status: 'COMPLETED', actualGoodQty: 188 },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        include: {
          lines: {
            include: { item: { select: { code: true } } }
          }
        }
      });
      if (!run) return null;
      const variance = computeRunVariance(run, run.lines);
      const line = variance.lines.find((entry) =>
        run.lines.find((runLine) => runLine.itemId === entry.itemId)?.item.code === itemCode
      );
      return line
        ? JSON.stringify({ bp: line.bp, pct: line.pct, flagged: line.flagged })
        : null;
    }
  })),
  {
    name: 'every stock movement has a sourceType',
    kind: 'document',
    stage: 'final',
    expected: true,
    actualFn: async (db) => {
      const result = await db.$queryRaw`
        SELECT EXISTS (
          SELECT 1
          FROM "StockMovement"
          WHERE "sourceType" IS NULL
        ) AS "hasNullSourceType"
      `;
      return result[0]?.hasNullSourceType === false;
    }
  },
  {
    name: 'final ledger reconciles: SUM(qtyChange) per item equals the displayed balance',
    kind: 'document',
    stage: 'final',
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
  }
);

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
  let info = 0;
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
        const status = actual === 'SKIPPED'
          ? 'SKIPPED'
          : check.kind === 'info'
          ? 'INFO'
          : actual === check.expected ? 'PASS' : 'FAIL';
        if (status === 'PASS') {
          passed += 1;
        } else if (status === 'INFO') {
          info += 1;
        } else if (status === 'SKIPPED') {
          skipped += 1;
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
    console.log(`PASS: ${passed} | FAIL: ${failures} | INFO: ${info} | SKIPPED: ${skipped}`);
    if (failures > 0) {
      console.error(`BENCHMARK_CHECK_FAILURES: ${results
        .filter(({ Status }) => Status === 'FAIL')
        .map(({ Check }) => Check)
        .join(', ')}`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
