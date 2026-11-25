import { AppError, badRequest, notFound } from '../lib/errors.js';
import { formatQty } from '../lib/units.js';
import { isFlagged, varianceBp } from '../lib/variance.js';

const INTEGER_MIN = -2147483648;
const INTEGER_MAX = 2147483647;

const runInclude = {
  finishedItem: {
    select: { id: true, code: true, name: true }
  },
  lines: {
    include: {
      item: {
        select: {
          id: true,
          code: true,
          name: true,
          displayUnit: { select: { code: true } }
        }
      }
    },
    orderBy: { item: { code: 'asc' } }
  }
};

function assertVarianceFitsDatabase(bp, name) {
  if (!Number.isSafeInteger(bp) || bp < INTEGER_MIN || bp > INTEGER_MAX) {
    throw badRequest(`${name} exceeds the supported variance range`);
  }
}

function formatPercent(bp) {
  const magnitude = BigInt(Math.abs(bp));
  const whole = (magnitude / 100n).toString();
  const fraction = (magnitude % 100n).toString().padStart(2, '0');
  return `${bp < 0 ? '-' : ''}${whole}.${fraction}`;
}

function formatSignedPercent(bp) {
  return `${bp > 0 ? '+' : ''}${formatPercent(bp)}%`;
}

function computeEntry(plannedQty, actualQty, toleranceBp, name) {
  if (!Number.isSafeInteger(plannedQty) || plannedQty <= 0) {
    throw badRequest(`${name} planned quantity must be a positive integer`);
  }
  if (!Number.isSafeInteger(actualQty) || actualQty < 0) {
    throw badRequest(`${name} actual quantity must be a non-negative integer`);
  }
  const diffQty = actualQty - plannedQty;
  const bp = varianceBp(plannedQty, actualQty);
  assertVarianceFitsDatabase(bp, name);
  return {
    plannedQty,
    actualQty,
    diffQty,
    bp,
    pct: formatPercent(bp),
    flagged: isFlagged(bp, toleranceBp)
  };
}

export function computeRunVariance(run, lines) {
  if (!run || typeof run !== 'object') {
    throw badRequest('Production run is required');
  }
  if (!Array.isArray(lines)) {
    throw badRequest('Production run lines must be an array');
  }
  if (!Number.isSafeInteger(run.toleranceBpUsed) || run.toleranceBpUsed < 0) {
    throw badRequest('Run variance tolerance must be a non-negative integer');
  }
  if (run.actualGoodQty === null || run.actualGoodQty === undefined) {
    throw badRequest('Production run has no actual output');
  }

  const yieldVariance = computeEntry(
    run.plannedOutputQty,
    run.actualGoodQty,
    run.toleranceBpUsed,
    'Yield'
  );
  const yieldResult = {
    plannedOutputQty: yieldVariance.plannedQty,
    actualGoodQty: yieldVariance.actualQty,
    diffQty: yieldVariance.diffQty,
    bp: yieldVariance.bp,
    pct: yieldVariance.pct,
    flagged: yieldVariance.flagged
  };

  const lineResults = lines.map((line) => {
    const variance = computeEntry(
      line.plannedQty,
      line.issuedQty,
      run.toleranceBpUsed,
      `Item ${line.itemId}`
    );
    const item = line.item;
    return {
      itemId: line.itemId,
      itemName: item?.name ?? line.itemName,
      plannedQty: line.plannedQty,
      issuedQty: line.issuedQty,
      scrapQty: line.scrapQty,
      diffQty: variance.diffQty,
      bp: variance.bp,
      pct: variance.pct,
      flagged: variance.flagged
    };
  });

  const alerts = [];
  if (yieldResult.flagged) {
    alerts.push(
      `Yield ${yieldResult.actualGoodQty} vs ${yieldResult.plannedOutputQty} expected (${formatSignedPercent(yieldResult.bp)}) - flagged`
    );
  }
  for (const result of lineResults) {
    if (!result.flagged) {
      continue;
    }
    const line = lines.find(({ itemId }) => itemId === result.itemId);
    const displayUnit = line.item?.displayUnit?.code;
    const issued = displayUnit ? formatQty(result.issuedQty, displayUnit) : String(result.issuedQty);
    const planned = displayUnit ? formatQty(result.plannedQty, displayUnit) : String(result.plannedQty);
    alerts.push(
      `${result.itemName} used ${issued} vs ${planned} planned (${formatSignedPercent(result.bp)}) - flagged`
    );
  }

  return { yield: yieldResult, lines: lineResults, alerts };
}

export async function applyRunVariance(tx, runId) {
  const run = await tx.productionRun.findUnique({
    where: { id: runId },
    include: runInclude
  });
  if (!run) {
    throw notFound('Production run not found');
  }
  if (run.status !== 'COMPLETED') {
    throw new AppError(409, 'RUN_NOT_COMPLETED', 'Variance is available only for completed runs', {
      runId,
      status: run.status
    });
  }

  const variance = computeRunVariance(run, run.lines);
  await tx.productionRun.update({
    where: { id: run.id },
    data: {
      yieldVarianceBp: variance.yield.bp,
      yieldFlagged: variance.yield.flagged
    }
  });
  for (const line of variance.lines) {
    await tx.productionRunLine.update({
      where: { runId_itemId: { runId: run.id, itemId: line.itemId } },
      data: { varianceBp: line.bp, flagged: line.flagged }
    });
  }
  return variance;
}

function assertRunId(runId) {
  if (!Number.isSafeInteger(runId) || runId <= 0 || runId > INTEGER_MAX) {
    throw badRequest('id must be a positive PostgreSQL integer');
  }
}

export async function getRunVariance(db, runId) {
  assertRunId(runId);
  const run = await db.productionRun.findUnique({
    where: { id: runId },
    include: runInclude
  });
  if (!run) {
    throw notFound('Production run not found');
  }
  if (run.status !== 'COMPLETED') {
    throw new AppError(409, 'RUN_NOT_COMPLETED', 'Variance is available only for completed runs', {
      runId,
      status: run.status
    });
  }
  return {
    runId: run.id,
    runNo: run.runNo,
    toleranceBpUsed: run.toleranceBpUsed,
    ...computeRunVariance(run, run.lines)
  };
}

export async function listRunVariances(db, { from, to, flaggedOnly, page, limit }) {
  if (from && (!(from instanceof Date) || Number.isNaN(from.getTime()))) {
    throw badRequest('from must be a valid Date');
  }
  if (to && (!(to instanceof Date) || Number.isNaN(to.getTime()))) {
    throw badRequest('to must be a valid Date');
  }
  if (from && to && from > to) {
    throw badRequest('from must be earlier than or equal to to');
  }
  if (typeof flaggedOnly !== 'boolean') {
    throw badRequest('flaggedOnly must be a boolean');
  }
  if (!Number.isSafeInteger(page) || page <= 0) {
    throw badRequest('page must be a positive integer');
  }
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw badRequest('limit must be an integer from 1 to 100');
  }

  const completedAt = {};
  if (from) completedAt.gte = from;
  if (to) completedAt.lte = to;
  const where = {
    status: 'COMPLETED',
    ...(Object.keys(completedAt).length > 0 ? { completedAt } : {})
  };
  if (flaggedOnly) {
    const candidates = await db.productionRun.findMany({
      where: {
        ...where,
        OR: [
          { yieldFlagged: true },
          { lines: { some: { flagged: true } } },
          { yieldVarianceBp: null }
        ]
      },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      include: runInclude
    });
    const filtered = candidates
      .map((run) => presentRunVariance(run))
      .filter((run) => run.alertCount > 0);
    const start = (page - 1) * limit;
    return {
      items: filtered.slice(start, start + limit),
      page,
      limit,
      total: filtered.length
    };
  }

  const [runs, total] = await Promise.all([
    db.productionRun.findMany({
      where,
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: runInclude
    }),
    db.productionRun.count({ where })
  ]);
  return {
    items: runs.map(presentRunVariance),
    page,
    limit,
    total
  };
}

function presentRunVariance(run) {
  const variance = computeRunVariance(run, run.lines);
  return {
    runId: run.id,
    runNo: run.runNo,
    completedAt: run.completedAt,
    finishedItem: run.finishedItem,
    actualGoodQty: run.actualGoodQty,
    yieldFlagged: variance.yield.flagged,
    alertCount: variance.alerts.length
  };
}
