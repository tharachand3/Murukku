import Decimal from 'decimal.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { fromBase } from '../lib/units.js';
import {
  formatMarginPct,
  formatPaiseDecimalAsRupees,
  formatRupees,
  lineCostVariance,
  marginPerPacket,
  splitCostPerPacket
} from '../lib/costMath.js';
import { currentFinancialYear, financialYearRange } from '../lib/fy.js';
import { istDayRange } from '../lib/istDate.js';
import { getAverageRateAsOf } from './costingService.js';

const INTEGER_MAX = 2147483647;
const DecimalCost = Decimal.clone({ precision: 40 });
const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const kindLabels = Object.freeze({
  LABOUR: 'Labour',
  POWER_GAS: 'Power / gas',
  OTHER: 'Other'
});

function assertSafeInteger(value, label) {
  let number = value;
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new AppError(422, 'COST_TOTAL_RANGE', `${label} exceeds the safe integer range`);
    }
    number = Number(value);
  } else if (value instanceof Decimal) {
    const text = value.toString();
    number = Number(text);
    if (!Number.isSafeInteger(number) || number.toString() !== text) {
      throw new AppError(422, 'COST_TOTAL_RANGE', `${label} exceeds the safe integer range`);
    }
  }
  if (!Number.isSafeInteger(number)) {
    throw new AppError(422, 'COST_TOTAL_RANGE', `${label} exceeds the safe integer range`);
  }
  return number;
}

function displayQty(qtyBase, unit) {
  return fromBase(qtyBase, unit).toString();
}

function moneyDisplay(paise) {
  return formatRupees(paise);
}

export async function getRunCostSheet(db, runId) {
  if (!Number.isSafeInteger(runId) || runId <= 0 || runId > INTEGER_MAX) {
    throw badRequest('runId must be a positive integer');
  }
  const run = await db.productionRun.findUnique({
    where: { id: runId },
    include: {
      finishedItem: {
        select: {
          id: true,
          code: true,
          name: true,
          sellingPricePaise: true
        }
      },
      lines: {
        include: {
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              type: true,
              displayUnit: { select: { code: true } }
            }
          }
        },
        orderBy: { item: { code: 'asc' } }
      },
      overheads: { orderBy: { id: 'asc' } }
    }
  });
  if (!run) {
    throw notFound('Production run not found');
  }

  const asOf = run.completedAt ?? new Date();
  const materials = await Promise.all(run.lines.map(async (line) => {
    let rate = new Decimal(line.ratePaisePerBase.toString());
    let variance;
    if (line.issuedQty === 0 && rate.isZero()) {
      const average = await getAverageRateAsOf(db, line.itemId, asOf);
      rate = average.ratePaisePerBase ?? new Decimal(0);
      const plannedCostPaise = rate.isZero()
        ? 0
        : lineCostVariance({
            plannedQty: line.plannedQty,
            issuedQty: 0,
            ratePaisePerBase: rate
          }).plannedCostPaise;
      variance = {
        plannedCostPaise,
        actualCostPaise: 0,
        costVariancePaise: -plannedCostPaise
      };
    } else {
      variance = lineCostVariance({
        plannedQty: line.plannedQty,
        issuedQty: line.issuedQty,
        ratePaisePerBase: rate
      });
    }

    return {
      itemId: line.itemId,
      code: line.item.code,
      name: line.item.name,
      type: line.item.type,
      unit: line.item.displayUnit.code,
      plannedQty: displayQty(line.plannedQty, line.item.displayUnit.code),
      issuedQty: displayQty(line.issuedQty, line.item.displayUnit.code),
      scrapQty: displayQty(line.scrapQty, line.item.displayUnit.code),
      ratePaisePerBase: rate.toString(),
      ...variance
    };
  }));
  const materialTotals = materials.reduce((totals, line) => ({
    plannedCostPaise: assertSafeInteger(
      totals.plannedCostPaise + line.plannedCostPaise,
      'Planned material total'
    ),
    actualCostPaise: assertSafeInteger(
      totals.actualCostPaise + line.actualCostPaise,
      'Actual material total'
    ),
    costVariancePaise: assertSafeInteger(
      totals.costVariancePaise + line.costVariancePaise,
      'Material variance total'
    )
  }), {
    plannedCostPaise: 0,
    actualCostPaise: 0,
    costVariancePaise: 0
  });
  const overheadTotal = run.overheads.reduce((total, row) =>
    assertSafeInteger(total + row.amountPaise, 'Overhead total'), 0
  );
  const goodQty = run.actualGoodQty;
  const completedWithGoodOutput = run.status === 'COMPLETED' && goodQty > 0;
  const perPacket = completedWithGoodOutput
    ? splitCostPerPacket({
        materialCostPaise: run.materialCostPaise ?? materialTotals.actualCostPaise,
        overheadCostPaise: run.overheadCostPaise ?? overheadTotal,
        goodQty
      })
    : null;
  const sellingPricePaise = run.finishedItem.sellingPricePaise;
  const margin = perPacket && sellingPricePaise !== null
    ? marginPerPacket({
        sellingPricePaise,
        costPerPacketPaise: perPacket.totalPerPacket
      })
    : null;

  return {
    run: {
      id: run.id,
      runNo: run.runNo,
      status: run.status,
      product: {
        id: run.finishedItem.id,
        code: run.finishedItem.code,
        name: run.finishedItem.name
      },
      batchCount: run.batchCount.toString(),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      plannedOutputQty: run.plannedOutputQty,
      goodQty
    },
    materials,
    materialTotals,
    overheads: {
      rows: run.overheads.map((row) => ({
        id: row.id,
        kind: row.kind,
        kindLabel: kindLabels[row.kind],
        amountPaise: row.amountPaise,
        note: row.note
      })),
      totalPaise: overheadTotal
    },
    totalCostPaise: assertSafeInteger(
      (run.materialCostPaise ?? materialTotals.actualCostPaise) +
        (run.overheadCostPaise ?? overheadTotal),
      'Run total cost'
    ),
    perPacket: perPacket
      ? {
          materialPaise: perPacket.materialPerPacket.toFixed(4),
          overheadPaise: perPacket.overheadPerPacket.toFixed(4),
          totalPaise: perPacket.totalPerPacket.toFixed(4),
          display: formatPaiseDecimalAsRupees(perPacket.totalPerPacket)
        }
      : null,
    price: sellingPricePaise === null
      ? null
      : {
          sellingPricePaise,
          display: moneyDisplay(sellingPricePaise)
        },
    margin: margin
      ? {
          perPacketPaise: margin.marginPaise.toFixed(4),
          perPacketDisplay: formatPaiseDecimalAsRupees(margin.marginPaise),
          bp: margin.marginBp,
          pctDisplay: formatMarginPct(margin.marginBp)
        }
      : null
  };
}

function periodFromInput({ from, to }) {
  const today = IST_DATE.format(new Date());
  const fy = financialYearRange(currentFinancialYear());
  const defaultFrom = IST_DATE.format(fy.start);
  const fromDate = from ?? defaultFrom;
  const toDate = to ?? today;
  let range;
  try {
    range = istDayRange(fromDate, toDate);
  } catch (error) {
    throw new AppError(400, 'INVALID_PERIOD', error.message);
  }
  if (!range.gte || !range.lt) {
    throw new Error('IST period range did not produce both boundaries');
  }
  if (range.lt.getTime() - range.gte.getTime() > 731 * 24 * 60 * 60 * 1000) {
    throw new AppError(422, 'PERIOD_TOO_LONG', 'Costing period cannot exceed 731 days');
  }
  return { from: fromDate, to: toDate, start: range.gte, endExclusive: range.lt };
}

export async function getProductCosting(db, { from, to, finishedItemId } = {}) {
  if (
    finishedItemId !== undefined &&
    (!Number.isSafeInteger(finishedItemId) || finishedItemId <= 0 || finishedItemId > INTEGER_MAX)
  ) {
    throw badRequest('finishedItemId must be a positive integer');
  }
  const period = periodFromInput({ from, to });
  const where = {
    status: 'COMPLETED',
    completedAt: { gte: period.start, lt: period.endExclusive },
    ...(finishedItemId !== undefined ? { finishedItemId } : {})
  };
  const [aggregates, runs] = await Promise.all([
    db.productionRun.groupBy({
      by: ['finishedItemId'],
      where,
      _count: { _all: true },
      _sum: {
        actualGoodQty: true,
        materialCostPaise: true,
        overheadCostPaise: true
      }
    }),
    db.productionRun.findMany({
      where,
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      select: {
        finishedItemId: true,
        runNo: true,
        completedAt: true,
        costPerPacketPaise: true,
        finishedItem: {
          select: {
            id: true,
            code: true,
            name: true,
            sellingPricePaise: true
          }
        }
      }
    })
  ]);
  const latestByItemId = new Map();
  for (const run of runs) {
    if (!latestByItemId.has(run.finishedItemId)) {
      latestByItemId.set(run.finishedItemId, run);
    }
  }

  const products = aggregates.map((aggregate) => {
    const latestRun = latestByItemId.get(aggregate.finishedItemId);
    if (!latestRun) {
      throw new Error(`Latest completed run missing for item ${aggregate.finishedItemId}`);
    }
    const goodQty = assertSafeInteger(aggregate._sum.actualGoodQty ?? 0, 'Product good quantity');
    const materialCostPaise = assertSafeInteger(
      aggregate._sum.materialCostPaise ?? 0,
      'Product material cost'
    );
    const overheadCostPaise = assertSafeInteger(
      aggregate._sum.overheadCostPaise ?? 0,
      'Product overhead cost'
    );
    const totalCostPaise = assertSafeInteger(
      materialCostPaise + overheadCostPaise,
      'Product total cost'
    );
    const item = latestRun.finishedItem;
    const avgCostPerPacketPaise = goodQty > 0
      ? new DecimalCost(totalCostPaise)
          .div(goodQty)
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      : null;
    const margin = avgCostPerPacketPaise && item.sellingPricePaise !== null
      ? marginPerPacket({
          sellingPricePaise: item.sellingPricePaise,
          costPerPacketPaise: avgCostPerPacketPaise
        })
      : null;
    return {
      itemId: item.id,
      code: item.code,
      name: item.name,
      runCount: aggregate._count._all,
      goodQty,
      materialCostPaise,
      overheadCostPaise,
      totalCostPaise,
      avgCostPerPacketPaise: avgCostPerPacketPaise?.toFixed(4) ?? null,
      latestRun: {
        runNo: latestRun.runNo,
        completedAt: latestRun.completedAt,
        costPerPacketPaise: latestRun.costPerPacketPaise?.toFixed(4) ?? null
      },
      sellingPricePaise: item.sellingPricePaise,
      margin: margin
        ? {
            perPacketPaise: margin.marginPaise.toFixed(4),
            bp: margin.marginBp,
            pctDisplay: formatMarginPct(margin.marginBp)
          }
        : null
    };
  });
  products.sort((left, right) => left.code.localeCompare(right.code));

  return {
    period: { from: period.from, to: period.to },
    products
  };
}
