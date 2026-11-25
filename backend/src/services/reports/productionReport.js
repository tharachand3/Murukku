import Decimal from 'decimal.js';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { lineCostVariance } from '../../lib/costMath.js';
import { fromBase } from '../../lib/units.js';
import { wastageByItem, yieldByProduct } from '../../lib/productionAgg.js';
import {
  defineReport,
  formatIstDate,
  makeSection,
  pageFilterShape,
  periodFilterShape,
  resolvePeriod
} from '../../lib/reportKit.js';

const filtersSchema = z.object({
  ...periodFilterShape.shape,
  status: z.enum(['ALL', 'COMPLETED', 'ISSUED', 'CANCELLED']).default('COMPLETED'),
  finishedItemId: z.coerce.number().int().positive().max(2147483647).optional(),
  flaggedOnly: z.enum(['true', 'false']).default('false')
    .transform((value) => value === 'true'),
  ...pageFilterShape.shape
}).strict();

const filterDocs = [
  { name: 'from', type: 'date', description: 'First inclusive IST calendar day' },
  { name: 'to', type: 'date', description: 'Last inclusive IST calendar day' },
  { name: 'status', type: 'text', description: 'ALL, COMPLETED, ISSUED, or CANCELLED' },
  { name: 'finishedItemId', type: 'int', description: 'Filter to one finished product' },
  { name: 'flaggedOnly', type: 'text', description: 'Only runs with stored yield or line flags' },
  { name: 'page', type: 'int', description: 'Run page number, starting at 1' },
  { name: 'limit', type: 'int', description: 'Runs per page, from 1 to 200' }
];

const runColumns = [
  { key: 'runNo', label: 'Run no.', type: 'text' },
  { key: 'productCode', label: 'Product code', type: 'text' },
  { key: 'productName', label: 'Product', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'startedDate', label: 'Started date', type: 'date' },
  { key: 'completedDate', label: 'Completed date', type: 'date' },
  { key: 'batches', label: 'Batches', type: 'decimal' },
  { key: 'plannedOutput', label: 'Planned output', type: 'int' },
  { key: 'goodOutput', label: 'Good output', type: 'int' },
  { key: 'rejected', label: 'Rejected', type: 'int' },
  { key: 'yieldVarianceBp', label: 'Yield variance (bp)', type: 'percentBp' },
  { key: 'yieldFlagged', label: 'Yield flagged', type: 'text' },
  { key: 'flaggedLines', label: 'Flagged material lines', type: 'int' },
  { key: 'materialCostPaise', label: 'Material cost', type: 'money' },
  { key: 'overheadCostPaise', label: 'Overhead cost', type: 'money' },
  { key: 'totalCostPaise', label: 'Total cost', type: 'money' },
  { key: 'costPerPacketPaise', label: 'Cost per packet (paise)', type: 'moneyDecimal' }
];

const consumptionColumns = [
  { key: 'runNo', label: 'Run no.', type: 'text' },
  { key: 'itemCode', label: 'Item code', type: 'text' },
  { key: 'itemName', label: 'Material', type: 'text' },
  { key: 'type', label: 'Type', type: 'text' },
  { key: 'unit', label: 'Unit', type: 'text' },
  { key: 'plannedQty', label: 'Planned quantity', type: 'decimal' },
  { key: 'issuedQty', label: 'Issued quantity', type: 'decimal' },
  { key: 'scrapQty', label: 'Scrap quantity', type: 'decimal' },
  { key: 'varianceQty', label: 'Quantity variance', type: 'decimal' },
  { key: 'varianceBp', label: 'Variance (bp)', type: 'percentBp' },
  { key: 'flagged', label: 'Flagged', type: 'text' },
  { key: 'plannedCostPaise', label: 'Planned cost', type: 'money' },
  { key: 'actualCostPaise', label: 'Actual cost', type: 'money' },
  { key: 'costVariancePaise', label: 'Cost variance', type: 'money' }
];

const wastageColumns = [
  { key: 'itemCode', label: 'Item code', type: 'text' },
  { key: 'itemName', label: 'Material', type: 'text' },
  { key: 'unit', label: 'Unit', type: 'text' },
  { key: 'scrapQty', label: 'Scrap quantity', type: 'decimal' },
  { key: 'scrapValuePaise', label: 'Scrap value', type: 'money' },
  { key: 'excessQty', label: 'Excess quantity', type: 'decimal' },
  { key: 'excessValuePaise', label: 'Excess value', type: 'money' }
];

const yieldColumns = [
  { key: 'productCode', label: 'Product code', type: 'text' },
  { key: 'productName', label: 'Product', type: 'text' },
  { key: 'runs', label: 'Runs', type: 'int' },
  { key: 'plannedOutput', label: 'Planned output', type: 'int' },
  { key: 'goodOutput', label: 'Good output', type: 'int' },
  { key: 'shortfall', label: 'Shortfall', type: 'int' },
  { key: 'shortfallBp', label: 'Yield variance (bp)', type: 'percentBp' }
];

function safeInteger(value, name) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return value;
}

function addSafe(left, right, name) {
  return safeInteger(left + right, name);
}

function inPeriod(date, period) {
  return date >= period.start && date < period.endExclusive;
}

function toConsumptionLine(run, line) {
  const unit = line.item.displayUnit.code;
  const costs = lineCostVariance({
    plannedQty: line.plannedQty,
    issuedQty: line.issuedQty,
    ratePaisePerBase: line.ratePaisePerBase.toString()
  });
  return {
    runNo: run.runNo,
    itemCode: line.item.code,
    itemName: line.item.name,
    type: line.item.type,
    unit,
    plannedQty: fromBase(line.plannedQty, unit).toFixed(),
    issuedQty: fromBase(line.issuedQty, unit).toFixed(),
    scrapQty: fromBase(line.scrapQty, unit).toFixed(),
    varianceQty: fromBase(
      safeInteger(line.issuedQty - line.plannedQty, 'Quantity variance'),
      unit
    ).toFixed(),
    varianceBp: line.varianceBp,
    flagged: line.flagged ? 'YES' : 'NO',
    ...costs
  };
}

const productionReport = defineReport({
  key: 'production-report',
  title: 'Production Report',
  description: 'Production run yield, stored material variances, costs, and wastage. Consumption rows contain the material lines for runs on the selected run page.',
  group: 'production',
  capability: 'production:read',
  filtersSchema,
  filterDocs,
  sectionDocs: [
    { key: 'runs', title: 'Production runs' },
    { key: 'consumption', title: 'Material consumption and variance' },
    { key: 'wastage', title: 'Material wastage' },
    { key: 'yield', title: 'Yield by product' }
  ],
  async run(db, filters) {
    const period = resolvePeriod(filters);
    const where = {
      ...(filters.status !== 'ALL' ? { status: filters.status } : {}),
      ...(filters.finishedItemId !== undefined
        ? { finishedItemId: filters.finishedItemId }
        : {}),
      OR: [
        { startedAt: { gte: period.start, lt: period.endExclusive } },
        { completedAt: { gte: period.start, lt: period.endExclusive } }
      ]
    };
    const candidates = await db.productionRun.findMany({
      where,
      orderBy: [{ startedAt: 'asc' }, { runNo: 'asc' }],
      take: 50001,
      include: {
        finishedItem: { select: { id: true, code: true, name: true } },
        lines: {
          orderBy: [{ item: { type: 'asc' } }, { item: { code: 'asc' } }],
          include: {
            item: {
              select: {
                id: true,
                code: true,
                name: true,
                type: true,
                displayUnit: { select: { code: true, baseFactor: true } }
              }
            }
          }
        },
        overheads: { select: { amountPaise: true } }
      }
    });

    if (candidates.length > 50000) {
      throw new AppError(422, 'TOO_MANY_ROWS', 'Production report cannot exceed 50000 runs');
    }

    const runs = candidates
      .filter((run) => inPeriod(run.completedAt ?? run.startedAt, period))
      .filter((run) => !filters.flaggedOnly ||
        run.yieldFlagged || run.lines.some((line) => line.flagged))
      .sort((left, right) => {
        const leftDate = left.completedAt ?? left.startedAt;
        const rightDate = right.completedAt ?? right.startedAt;
        return leftDate - rightDate || left.runNo.localeCompare(right.runNo);
      });

    const allConsumption = runs.flatMap((run) =>
      run.lines.map((line) => toConsumptionLine(run, line))
    );
    if (runs.length > 50000 || allConsumption.length > 50000) {
      throw new AppError(422, 'TOO_MANY_ROWS', 'Production report sections cannot exceed 50000 rows');
    }

    const allRunRows = runs.map((run) => {
      const materialCostPaise = safeInteger(run.materialCostPaise ?? 0, 'Material cost');
      const overheadCostPaise = safeInteger(run.overheadCostPaise ?? 0, 'Overhead cost');
      return {
        runNo: run.runNo,
        productCode: run.finishedItem.code,
        productName: run.finishedItem.name,
        status: run.status,
        startedDate: formatIstDate(run.startedAt),
        completedDate: run.completedAt ? formatIstDate(run.completedAt) : null,
        batches: run.batchCount.toString(),
        plannedOutput: safeInteger(run.plannedOutputQty, 'Planned output'),
        goodOutput: run.actualGoodQty === null
          ? null
          : safeInteger(run.actualGoodQty, 'Good output'),
        rejected: safeInteger(run.rejectedFinishedQty, 'Rejected output'),
        yieldVarianceBp: run.yieldVarianceBp,
        yieldFlagged: run.yieldFlagged ? 'YES' : 'NO',
        flaggedLines: safeInteger(
          run.lines.filter((line) => line.flagged).length,
          'Flagged material line count'
        ),
        materialCostPaise,
        overheadCostPaise,
        totalCostPaise: addSafe(materialCostPaise, overheadCostPaise, 'Total run cost'),
        costPerPacketPaise: run.costPerPacketPaise === null
          ? null
          : new Decimal(run.costPerPacketPaise.toString()).toFixed(4)
      };
    });
    const totals = allRunRows.reduce((result, run) => ({
      materialCostPaise: addSafe(
        result.materialCostPaise,
        run.materialCostPaise,
        'Material cost total'
      ),
      overheadCostPaise: addSafe(
        result.overheadCostPaise,
        run.overheadCostPaise,
        'Overhead cost total'
      ),
      totalCostPaise: addSafe(result.totalCostPaise, run.totalCostPaise, 'Run cost total'),
      goodOutput: addSafe(result.goodOutput, run.goodOutput ?? 0, 'Good output total')
    }), {
      materialCostPaise: 0,
      overheadCostPaise: 0,
      totalCostPaise: 0,
      goodOutput: 0
    });

    const start = (filters.page - 1) * filters.limit;
    const pageRuns = runs.slice(start, start + filters.limit);
    const pageRunNos = new Set(pageRuns.map((run) => run.runNo));
    const pageConsumption = allConsumption.filter((line) => pageRunNos.has(line.runNo));
    const page = {
      page: filters.page,
      limit: filters.limit,
      total: allRunRows.length,
      pages: Math.ceil(allRunRows.length / filters.limit)
    };

    const wastageRows = wastageByItem(runs.flatMap((run) =>
      run.lines.map((line) => ({
        itemId: line.itemId,
        itemCode: line.item.code,
        itemName: line.item.name,
        unit: line.item.displayUnit.code,
        baseFactor: line.item.displayUnit.baseFactor,
        plannedQty: line.plannedQty,
        issuedQty: line.issuedQty,
        scrapQty: line.scrapQty,
        ratePaisePerBase: line.ratePaisePerBase.toString()
      }))
    )).map((row) => ({
      itemCode: row.itemCode,
      itemName: row.itemName,
      unit: row.unit,
      scrapQty: fromBase(row.scrapBase, row.unit).toFixed(),
      scrapValuePaise: row.scrapValuePaise,
      excessQty: fromBase(row.excessBase, row.unit).toFixed(),
      excessValuePaise: row.excessValuePaise
    }));
    const wastageTotals = wastageRows.reduce((result, row) => ({
      scrapValuePaise: addSafe(result.scrapValuePaise, row.scrapValuePaise, 'Scrap value total'),
      excessValuePaise: addSafe(result.excessValuePaise, row.excessValuePaise, 'Excess value total')
    }), { scrapValuePaise: 0, excessValuePaise: 0 });

    const yieldRows = yieldByProduct(runs
      .filter((run) => run.status === 'COMPLETED' && run.actualGoodQty !== null)
      .map((run) => ({
        productId: run.finishedItem.id,
        productCode: run.finishedItem.code,
        productName: run.finishedItem.name,
        plannedOutputQty: run.plannedOutputQty,
        actualGoodQty: run.actualGoodQty
      }))
    ).map(({ productCode, productName, runs: runCount, plannedOutput, goodOutput, shortfall, shortfallBp }) => ({
      productCode,
      productName,
      runs: runCount,
      plannedOutput,
      goodOutput,
      shortfall,
      shortfallBp
    }));

    return {
      title: 'Production Report',
      period: { from: period.fromDate, to: period.toDate },
      sections: [
        makeSection({
          key: 'runs',
          title: 'Production runs',
          columns: runColumns,
          rows: allRunRows.slice(start, start + filters.limit),
          totals,
          page
        }),
        makeSection({
          key: 'consumption',
          title: 'Material consumption and variance',
          columns: consumptionColumns,
          rows: pageConsumption,
          page
        }),
        makeSection({
          key: 'wastage',
          title: 'Material wastage',
          columns: wastageColumns,
          rows: wastageRows,
          totals: wastageTotals
        }),
        makeSection({
          key: 'yield',
          title: 'Yield by product',
          columns: yieldColumns,
          rows: yieldRows
        })
      ]
    };
  }
});

export default productionReport;
