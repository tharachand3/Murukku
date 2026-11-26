import { formatPaiseDecimalAsRupees } from '../lib/costMath.js';
import { formatIstDate } from '../lib/reportKit.js';
import { istDayRange } from '../lib/istDate.js';
import { getBalances } from './ledgerService.js';
import { getShortageSummary } from './availabilityService.js';
import { getProductCosting } from './costSheetService.js';
import { listOutstanding } from './paymentService.js';
import receivablesAgeing from './reports/receivablesAgeing.js';
import { computeRunVariance } from './varianceService.js';

function safeInteger(value, label) {
  if (value === null || value === undefined) {
    throw new RangeError(`${label} is missing`);
  }
  if (typeof value === 'bigint') {
    if (
      value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new RangeError(`${label} exceeds the safe integer range`);
    }
    return Number(value);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
  return value;
}

function shiftCalendarDate(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

async function getTodaySummary(db, today) {
  const range = istDayRange(today, today);
  const [orderTotals, invoiceTotals, paymentTotals, dispatchCount] = await Promise.all([
    db.$queryRaw`
      SELECT
        COUNT(DISTINCT orders."id")::int AS "count",
        COALESCE(
          SUM(lines."qty"::bigint * lines."pricePaise"::bigint),
          0
        )::bigint AS "taxablePaise"
      FROM "Order" AS orders
      LEFT JOIN "OrderLine" AS lines ON lines."orderId" = orders."id"
      WHERE orders."createdAt" >= ${range.gte}
        AND orders."createdAt" < ${range.lt}
    `,
    db.invoice.aggregate({
      where: { status: 'POSTED', issueDate: range },
      _count: { _all: true },
      _sum: { totalPaise: true }
    }),
    db.payment.aggregate({
      where: { paymentDate: range },
      _count: { _all: true },
      _sum: { amountPaise: true }
    }),
    db.dispatch.count({ where: { dispatchDate: range } })
  ]);
  const orders = orderTotals[0];
  return {
    date: today,
    orders: {
      count: safeInteger(orders.count, "Today's order count"),
      taxablePaise: safeInteger(orders.taxablePaise, "Today's taxable amount")
    },
    invoices: {
      count: safeInteger(invoiceTotals._count._all, "Today's invoice count"),
      totalPaise: safeInteger(invoiceTotals._sum.totalPaise ?? 0, "Today's invoice total")
    },
    payments: {
      count: safeInteger(paymentTotals._count._all, "Today's payment count"),
      amountPaise: safeInteger(paymentTotals._sum.amountPaise ?? 0, "Today's payment amount")
    },
    dispatches: { count: safeInteger(dispatchCount, "Today's dispatch count") }
  };
}

async function getPendingApproval(db) {
  const result = await db.order.aggregate({
    where: { status: 'SUBMITTED' },
    _count: { _all: true },
    _min: { createdAt: true }
  });
  return {
    count: safeInteger(result._count._all, 'Pending approval count'),
    oldestOrderDate: result._min.createdAt ? formatIstDate(result._min.createdAt) : null
  };
}

async function getStockSummary(db) {
  const [balances, activeItems] = await Promise.all([
    getBalances(db),
    db.item.findMany({
      where: { isActive: true },
      select: { id: true, type: true, reorderLevelBase: true }
    })
  ]);
  const activeById = new Map(activeItems.map((item) => [item.id, item]));
  const stock = { finished: [], raw: [], packaging: [], low: [] };
  for (const balance of balances) {
    const item = activeById.get(balance.itemId);
    if (!item) {
      continue;
    }
    const stockItem = {
      itemId: balance.itemId,
      name: balance.name,
      balanceBase: safeInteger(balance.balanceBase, 'Stock balance'),
      display: balance.balanceDisplay
    };
    if (item.type === 'FINISHED') {
      stock.finished.push(stockItem);
    } else if (item.type === 'RAW') {
      stock.raw.push(stockItem);
    } else if (item.type === 'PACKAGING') {
      stock.packaging.push(stockItem);
    }
    if (
      item.type !== 'FINISHED' &&
      item.reorderLevelBase !== null &&
      balance.balanceBase <= item.reorderLevelBase
    ) {
      stock.low.push({
        ...stockItem,
        reorderLevelBase: safeInteger(item.reorderLevelBase, 'Reorder level')
      });
    }
  }
  return stock;
}

async function getVarianceSummary(db, now) {
  const today = formatIstDate(now);
  const firstDay = shiftCalendarDate(today, -29);
  const range = istDayRange(firstDay, today);
  const flaggedWhere = {
    status: 'COMPLETED',
    completedAt: { not: null },
    OR: [
      { yieldFlagged: true },
      { lines: { some: { flagged: true } } }
    ]
  };
  const [completedRuns, flaggedRuns, recentRuns] = await Promise.all([
    db.productionRun.count({
      where: { status: 'COMPLETED', completedAt: range }
    }),
    db.productionRun.count({
      where: { ...flaggedWhere, completedAt: range }
    }),
    db.productionRun.findMany({
      where: flaggedWhere,
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: 5,
      include: {
        lines: {
          include: {
            item: {
              select: {
                name: true,
                displayUnit: { select: { code: true } }
              }
            }
          },
          orderBy: { item: { code: 'asc' } }
        }
      }
    })
  ]);
  return {
    last30Days: {
      completedRuns: safeInteger(completedRuns, 'Completed run count'),
      flaggedRuns: safeInteger(flaggedRuns, 'Flagged run count')
    },
    recentAlerts: recentRuns.map((run) => ({
      runId: run.id,
      runNo: run.runNo,
      date: formatIstDate(run.completedAt),
      alerts: computeRunVariance(run, run.lines).alerts
    })).filter((run) => run.alerts.length > 0)
  };
}

async function getCostingSummary(db, now) {
  const latestRun = await db.productionRun.findFirst({
    where: {
      status: 'COMPLETED',
      completedAt: { not: null, lte: now }
    },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    select: { finishedItemId: true, completedAt: true }
  });
  if (!latestRun) {
    return {
      product: null,
      latestRun: null,
      sellingPricePaise: null,
      marginBp: null
    };
  }

  const runDate = formatIstDate(latestRun.completedAt);
  const costing = await getProductCosting(db, {
    from: runDate,
    to: runDate,
    finishedItemId: latestRun.finishedItemId
  });
  const product = costing.products.find(({ itemId }) => itemId === latestRun.finishedItemId);
  if (!product) {
    throw new Error(`Costing result missing for finished item ${latestRun.finishedItemId}`);
  }
  const costPerPacketPaise = product.latestRun.costPerPacketPaise;
  return {
    product: { itemId: product.itemId, name: product.name },
    latestRun: {
      runNo: product.latestRun.runNo,
      costPerPacketPaise,
      costPerPacketDisplay: costPerPacketPaise === null
        ? null
        : formatPaiseDecimalAsRupees(costPerPacketPaise)
    },
    sellingPricePaise: product.sellingPricePaise === null
      ? null
      : safeInteger(product.sellingPricePaise, 'Selling price'),
    marginBp: product.margin ? safeInteger(product.margin.bp, 'Product margin') : null
  };
}

async function getReceivablesSummary(db, today) {
  const [outstanding, ageing] = await Promise.all([
    listOutstanding(db),
    receivablesAgeing.run(db, { asOf: today, detail: 'false' })
  ]);
  const customers = ageing.sections.find(({ key }) => key === 'customers');
  if (!customers) {
    throw new Error('Receivables ageing result is missing its customer section');
  }
  const topCustomers = [...customers.rows]
    .filter((customer) => customer.outstandingPaise > 0)
    .sort((left, right) => (
      left.outstandingPaise === right.outstandingPaise
        ? left.customerName.localeCompare(right.customerName)
        : left.outstandingPaise > right.outstandingPaise ? -1 : 1
    ))
    .slice(0, 5)
    .map((customer) => ({
      customerId: safeInteger(customer.customerId, 'Customer ID'),
      name: customer.customerName,
      outstandingPaise: safeInteger(customer.outstandingPaise, 'Customer outstanding')
    }));
  return {
    outstandingPaise: safeInteger(outstanding.totals.outstandingPaise, 'Outstanding total'),
    creditPaise: safeInteger(outstanding.totals.creditPaise, 'Customer credit total'),
    over90Paise: safeInteger(customers.totals.bucket91PlusPaise, '91+ day receivables'),
    topCustomers
  };
}

export async function getDashboardSummary(db, { now = new Date() } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
  const today = formatIstDate(now);
  const [todaySummary, pendingApproval, stock, shortageSummary, variance, costing, receivables] =
    await Promise.all([
      getTodaySummary(db, today),
      getPendingApproval(db),
      getStockSummary(db),
      getShortageSummary(db),
      getVarianceSummary(db, now),
      getCostingSummary(db, now),
      getReceivablesSummary(db, today)
    ]);

  return {
    today: todaySummary,
    pendingApproval,
    stock,
    shortages: {
      totalShortPackets: safeInteger(shortageSummary.totalShortPackets, 'Total shortage'),
      items: shortageSummary.items.map((item) => ({
        itemId: safeInteger(item.itemId, 'Shortage item ID'),
        name: item.name,
        shortPackets: safeInteger(item.totalShortPackets, 'Item shortage'),
        suggestedBatches: item.suggestedBatches === null
          ? null
          : safeInteger(item.suggestedBatches, 'Suggested batch count')
      }))
    },
    variance,
    costing,
    receivables
  };
}
