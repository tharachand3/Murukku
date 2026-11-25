import Decimal from 'decimal.js';
import { writeAudit } from '../lib/audit.js';
import { planFromBatches } from '../lib/bomMath.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { mulRateQty, paiseToRupeesString } from '../lib/money.js';
import { formatQty, toBase, UNITS } from '../lib/units.js';
import { prisma } from '../lib/prisma.js';
import { addMovement } from './ledgerService.js';
import { nextNumber } from './numberingService.js';
import { getAverageRate } from './costingService.js';
import { applyRunVariance, computeRunVariance } from './varianceService.js';

const INTEGER_MAX = 2147483647;

const runInclude = {
  finishedItem: {
    select: {
      id: true,
      code: true,
      name: true,
      displayUnit: { select: { code: true } }
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
          baseUnit: { select: { code: true, dimension: true } },
          displayUnit: { select: { code: true } }
        }
      }
    },
    orderBy: { item: { code: 'asc' } }
  }
};
const runIncludeForBom = {
  finishedItem: { select: { id: true, type: true } },
  lines: {
    include: {
      item: {
        select: {
          id: true,
          name: true,
          type: true,
          baseUnit: { select: { code: true, dimension: true } },
          displayUnit: { select: { code: true } }
        }
      }
    }
  }
};

function assertPositiveInt(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > INTEGER_MAX) {
    throw badRequest(`${name} must be a positive PostgreSQL integer`);
  }
}

function convertIssue(issue, line) {
  if (typeof issue.unit !== 'string' || !Object.hasOwn(UNITS, issue.unit)) {
    throw badRequest(`Unsupported unit "${issue.unit}"`);
  }
  if (UNITS[issue.unit].dimension !== line.item.baseUnit.dimension) {
    throw badRequest(`Unit "${issue.unit}" does not match ${line.item.name}'s base-unit dimension`);
  }

  let qtyBase;
  try {
    qtyBase = toBase(issue.qty, issue.unit);
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) {
      throw badRequest(error.message);
    }
    throw error;
  }
  assertPositiveInt(qtyBase, 'qty');
  return qtyBase;
}

function convertCompletionQuantity(qty, unit, line, name) {
  if (typeof unit !== 'string' || !Object.hasOwn(UNITS, unit)) {
    throw badRequest(`Unsupported unit "${unit}"`);
  }
  if (UNITS[unit].dimension !== line.item.baseUnit.dimension) {
    throw badRequest(`Unit "${unit}" does not match ${line.item.name}'s base-unit dimension`);
  }

  let qtyBase;
  try {
    qtyBase = toBase(qty, unit);
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) {
      throw badRequest(error.message);
    }
    throw error;
  }
  if (!Number.isSafeInteger(qtyBase) || qtyBase < 0 || qtyBase > INTEGER_MAX) {
    throw badRequest(`${name} must be a non-negative PostgreSQL integer`);
  }
  return qtyBase;
}

function assertPaiseAmount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > INTEGER_MAX) {
    throw badRequest(`${name} exceeds the supported range`);
  }
}

function prepareIssues(bom, issues) {
  const bomLines = new Map(bom.lines.map((line) => [line.itemId, line]));
  const requestedIssues = issues === undefined
    ? bom.lines
      .filter((line) => line.item.type === 'RAW' && line.plannedQty > 0)
      .map((line) => ({
        itemId: line.itemId,
        qty: line.plannedQty,
        unit: line.item.baseUnit.code
      }))
    : issues;
  const seen = new Set();

  return requestedIssues.map((issue) => {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
      throw badRequest('Each issue must be an object');
    }
    assertPositiveInt(issue.itemId, 'itemId');
    if (seen.has(issue.itemId)) {
      throw badRequest('issues cannot contain duplicate itemIds', { itemId: issue.itemId });
    }
    seen.add(issue.itemId);

    const line = bomLines.get(issue.itemId);
    if (!line) {
      throw badRequest(`Item ${issue.itemId} is not in this BOM`);
    }
    return {
      itemId: issue.itemId,
      qtyBase: issues === undefined
        ? issue.qty
        : convertIssue(issue, line)
    };
  });
}

function presentRun(run) {
  const materialCostPaise = run.materialCostPaise ?? 0;
  return {
    ...run,
    lines: run.lines.map((line) => ({
      ...line,
      itemName: line.item.name,
      plannedQtyBase: line.plannedQty,
      plannedQtyDisplay: formatQty(line.plannedQty, line.item.displayUnit.code),
      issuedQtyBase: line.issuedQty,
      issuedQtyDisplay: formatQty(line.issuedQty, line.item.displayUnit.code),
      scrapQtyBase: line.scrapQty,
      scrapQtyDisplay: formatQty(line.scrapQty, line.item.displayUnit.code)
    })),
    runningMaterialCostPaise: materialCostPaise,
    runningMaterialCostDisplay: paiseToRupeesString(materialCostPaise)
  };
}

export async function startRun(userId, input) {
  assertPositiveInt(userId, 'userId');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Production run input must be an object');
  }
  if ((input.bomId === undefined) === (input.finishedItemId === undefined)) {
    throw badRequest('Provide exactly one of bomId or finishedItemId');
  }
  if (input.bomId !== undefined) {
    assertPositiveInt(input.bomId, 'bomId');
  } else {
    assertPositiveInt(input.finishedItemId, 'finishedItemId');
  }
  if (
    input.issues !== undefined &&
    (!Array.isArray(input.issues) ||
      input.issues.some((issue) => !issue || typeof issue !== 'object' || Array.isArray(issue)))
  ) {
    throw badRequest('issues must be an array of issue objects');
  }

  const startedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const bom = input.bomId !== undefined
      ? await tx.bom.findUnique({ where: { id: input.bomId }, include: runIncludeForBom })
      : await tx.bom.findFirst({
          where: { finishedItemId: input.finishedItemId, isActive: true },
          orderBy: { version: 'desc' },
          include: runIncludeForBom
        });
    if (!bom) {
      throw notFound(input.bomId !== undefined ? 'BOM not found' : 'No active BOM for finished item');
    }
    if (bom.finishedItem.type !== 'FINISHED') {
      throw badRequest('BOM must belong to a finished item');
    }
    if (input.finishedItemId !== undefined && bom.finishedItemId !== input.finishedItemId) {
      throw badRequest('BOM does not belong to the requested finished item');
    }

    let plan;
    try {
      plan = planFromBatches(bom, input.batchCount ?? '1');
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) {
        throw badRequest(error.message);
      }
      throw error;
    }
    const issues = prepareIssues(
      { ...bom, lines: bom.lines.map((line) => ({
        ...line,
        plannedQty: plan.lines.find((planned) => planned.itemId === line.itemId).plannedQty
      })) },
      input.issues
    );
    const setting = await tx.setting.findUnique({
      where: { key: 'VARIANCE_TOLERANCE_BP' },
      select: { value: true }
    });
    const toleranceBpUsed = Number(setting?.value ?? 300);
    if (!Number.isSafeInteger(toleranceBpUsed) || toleranceBpUsed < 0 || toleranceBpUsed > 5000) {
      throw new Error('VARIANCE_TOLERANCE_BP must be an integer from 0 to 5000');
    }

    const runNo = await nextNumber(tx, 'RUN', startedAt);
    const run = await tx.productionRun.create({
      data: {
        runNo,
        bomId: bom.id,
        finishedItemId: bom.finishedItemId,
        status: 'ISSUED',
        batchCount: new Decimal(plan.batchCount.toString()),
        plannedOutputQty: plan.plannedOutputQty,
        toleranceBpUsed,
        materialCostPaise: 0,
        batchNo: input.batchNo,
        startedAt,
        startedById: userId,
        notes: input.notes,
        lines: {
          create: bom.lines.map((line) => ({
            itemId: line.itemId,
            plannedQty: plan.lines.find((planned) => planned.itemId === line.itemId).plannedQty,
            issuedQty: 0,
            scrapQty: 0,
            costPaise: 0,
            ratePaisePerBase: 0
          }))
        }
      },
      include: runInclude
    });

    let materialCostPaise = 0;
    for (const issue of issues) {
      const averageRate = await getAverageRate(tx, issue.itemId, { asOf: startedAt });
      const rate = new Decimal(
        averageRate.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString()
      );
      const costPaise = mulRateQty(rate, issue.qtyBase);
      materialCostPaise += costPaise;
      if (!Number.isSafeInteger(materialCostPaise) || materialCostPaise > INTEGER_MAX) {
        throw badRequest('Production material cost exceeds the supported range');
      }

      await addMovement(tx, {
        itemId: issue.itemId,
        qtyChange: -issue.qtyBase,
        movementType: 'PRODUCTION_ISSUE',
        sourceType: 'PRODUCTION_RUN',
        sourceId: run.id,
        sourceRef: runNo,
        ratePaisePerBase: rate,
        batchNo: input.batchNo,
        movementDate: startedAt,
        userId
      });
      await tx.productionRunLine.update({
        where: { runId_itemId: { runId: run.id, itemId: issue.itemId } },
        data: {
          issuedQty: issue.qtyBase,
          ratePaisePerBase: rate,
          costPaise
        }
      });
    }

    const completedRun = await tx.productionRun.update({
      where: { id: run.id },
      data: { materialCostPaise },
      include: runInclude
    });
    await writeAudit(tx, {
      userId,
      action: 'CREATE',
      entity: 'ProductionRun',
      entityId: run.id,
      after: completedRun
    });
    return presentRun(completedRun);
  }, { maxWait: 10000, timeout: 30000 });
}

export async function completeRun(userId, runId, input) {
  assertPositiveInt(userId, 'userId');
  assertPositiveInt(runId, 'runId');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Production completion input must be an object');
  }
  if (!Number.isSafeInteger(input.actualGoodQty) || input.actualGoodQty < 0 || input.actualGoodQty > INTEGER_MAX) {
    throw badRequest('actualGoodQty must be a non-negative PostgreSQL integer');
  }
  const rejectedFinishedQty = input.rejectedFinishedQty ?? 0;
  if (
    !Number.isSafeInteger(rejectedFinishedQty) ||
    rejectedFinishedQty < 0 ||
    rejectedFinishedQty > INTEGER_MAX
  ) {
    throw badRequest('rejectedFinishedQty must be a non-negative PostgreSQL integer');
  }
  if (
    input.consumption !== undefined &&
    (!Array.isArray(input.consumption) ||
      input.consumption.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry)))
  ) {
    throw badRequest('consumption must be an array of consumption objects');
  }
  if (input.expiryDate !== undefined && input.expiryDate !== null &&
      (!(input.expiryDate instanceof Date) || Number.isNaN(input.expiryDate.getTime()))) {
    throw badRequest('expiryDate must be a valid Date');
  }

  const completedAt = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ProductionRun" WHERE id = ${runId} FOR UPDATE`;
    const before = await tx.productionRun.findUnique({
      where: { id: runId },
      include: runInclude
    });
    if (!before) {
      throw notFound('Production run not found');
    }
    if (before.status !== 'ISSUED') {
      throw new AppError(409, 'RUN_NOT_OPEN', 'Production run is not open for completion', {
        runId,
        status: before.status
      });
    }

    const linesByItemId = new Map(before.lines.map((line) => [line.itemId, line]));
    const entries = input.consumption ?? [];
    const seen = new Set();
    const consumption = entries.map((entry) => {
      assertPositiveInt(entry.itemId, 'itemId');
      if (seen.has(entry.itemId)) {
        throw badRequest('consumption cannot contain duplicate itemIds', {
          itemId: entry.itemId
        });
      }
      seen.add(entry.itemId);

      const line = linesByItemId.get(entry.itemId);
      if (!line) {
        throw badRequest(`Item ${entry.itemId} is not in this BOM`);
      }
      const qtyBase = convertCompletionQuantity(entry.qty, entry.unit, line, 'qty');
      const scrapQtyBase = convertCompletionQuantity(
        entry.scrapQty ?? '0',
        entry.scrapUnit ?? entry.unit,
        line,
        'scrapQty'
      );
      return { line, qtyBase, scrapQtyBase };
    });

    const ledgerRows = [];
    for (const entry of consumption) {
      const { line, qtyBase, scrapQtyBase } = entry;
      if (qtyBase === 0 && scrapQtyBase === 0) {
        continue;
      }

      const averageRate = await getAverageRate(tx, line.itemId, { asOf: completedAt });
      const rate = new Decimal(
        averageRate.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString()
      );
      let additionalCostPaise = 0;
      if (qtyBase > 0) {
        const costPaise = mulRateQty(rate, qtyBase);
        assertPaiseAmount(costPaise, 'Consumption cost');
        additionalCostPaise += costPaise;
        ledgerRows.push(await addMovement(tx, {
          itemId: line.itemId,
          qtyChange: -qtyBase,
          movementType: 'PRODUCTION_ISSUE',
          sourceType: 'PRODUCTION_RUN',
          sourceId: before.id,
          sourceRef: before.runNo,
          ratePaisePerBase: rate,
          batchNo: input.batchNo ?? before.batchNo,
          movementDate: completedAt,
          userId
        }));
      }
      if (scrapQtyBase > 0) {
        const scrapCostPaise = mulRateQty(rate, scrapQtyBase);
        assertPaiseAmount(scrapCostPaise, 'Scrap cost');
        additionalCostPaise += scrapCostPaise;
        ledgerRows.push(await addMovement(tx, {
          itemId: line.itemId,
          qtyChange: -scrapQtyBase,
          movementType: 'PRODUCTION_SCRAP',
          sourceType: 'PRODUCTION_RUN',
          sourceId: before.id,
          sourceRef: before.runNo,
          ratePaisePerBase: rate,
          batchNo: input.batchNo ?? before.batchNo,
          movementDate: completedAt,
          userId
        }));
      }

      const issuedQty = line.issuedQty + qtyBase + scrapQtyBase;
      const scrapQty = line.scrapQty + scrapQtyBase;
      const costPaise = line.costPaise + additionalCostPaise;
      if (issuedQty > INTEGER_MAX || scrapQty > INTEGER_MAX) {
        throw badRequest(`Issued quantity exceeds the supported range for "${line.item.name}"`);
      }
      assertPaiseAmount(costPaise, `Material cost for "${line.item.name}"`);
      await tx.productionRunLine.update({
        where: { runId_itemId: { runId: before.id, itemId: line.itemId } },
        data: {
          issuedQty,
          scrapQty,
          costPaise,
          ratePaisePerBase: rate
        }
      });
    }

    if (input.actualGoodQty > 0) {
      ledgerRows.push(await addMovement(tx, {
        itemId: before.finishedItemId,
        qtyChange: input.actualGoodQty,
        movementType: 'PRODUCTION_OUTPUT',
        sourceType: 'PRODUCTION_RUN',
        sourceId: before.id,
        sourceRef: before.runNo,
        batchNo: input.batchNo ?? before.batchNo ?? before.runNo,
        expiryDate: input.expiryDate,
        movementDate: completedAt,
        userId
      }));
    }

    const updatedLines = await tx.productionRunLine.findMany({
      where: { runId: before.id },
      select: { costPaise: true }
    });
    const materialCostPaise = updatedLines.reduce((total, line) => {
      const next = total + line.costPaise;
      assertPaiseAmount(next, 'Production material cost');
      return next;
    }, 0);
    await tx.productionRun.update({
      where: { id: before.id },
      data: {
        status: 'COMPLETED',
        actualGoodQty: input.actualGoodQty,
        rejectedFinishedQty,
        materialCostPaise,
        completedAt,
        completedById: userId,
        ...(input.batchNo !== undefined && input.batchNo !== null
          ? { batchNo: input.batchNo }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {})
      },
    });
    await applyRunVariance(tx, before.id);
    const after = await tx.productionRun.findUnique({
      where: { id: before.id },
      include: runInclude
    });
    await writeAudit(tx, {
      userId,
      action: 'UPDATE',
      entity: 'ProductionRun',
      entityId: before.id,
      before,
      after
    });
    return {
      ...presentRun(after),
      ledgerRows
    };
  }, { maxWait: 10000, timeout: 30000 });
}

function assertRunListInput({ status, from, to, finishedItemId, page, limit }) {
  if (status !== undefined && !['ISSUED', 'COMPLETED', 'CANCELLED'].includes(status)) {
    throw badRequest('status is invalid');
  }
  for (const [value, name] of [[from, 'from'], [to, 'to']]) {
    if (value !== undefined && (!(value instanceof Date) || Number.isNaN(value.getTime()))) {
      throw badRequest(`${name} must be a valid Date`);
    }
  }
  if (from && to && from > to) {
    throw badRequest('from must be earlier than or equal to to');
  }
  if (finishedItemId !== undefined) {
    assertPositiveInt(finishedItemId, 'finishedItemId');
  }
  if (!Number.isSafeInteger(page) || page <= 0) {
    throw badRequest('page must be a positive integer');
  }
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw badRequest('limit must be an integer from 1 to 100');
  }
}

function presentRunListItem(run) {
  const variance = run.status === 'COMPLETED'
    ? computeRunVariance(run, run.lines)
    : null;
  const flagsCount = variance
    ? Number(variance.yield.flagged) + variance.lines.filter((line) => line.flagged).length
    : 0;
  const materialCostPaise = run.materialCostPaise ?? 0;
  const displayUnit = run.finishedItem.displayUnit.code;

  return {
    id: run.id,
    runNo: run.runNo,
    product: run.finishedItem,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    plannedOutputQtyBase: run.plannedOutputQty,
    plannedOutputQtyDisplay: formatQty(run.plannedOutputQty, displayUnit),
    actualGoodQtyBase: run.actualGoodQty,
    actualGoodQtyDisplay: run.actualGoodQty === null
      ? null
      : formatQty(run.actualGoodQty, displayUnit),
    flagsCount,
    materialCostPaise,
    materialCostDisplay: paiseToRupeesString(materialCostPaise)
  };
}

export async function listRuns(db, input) {
  assertRunListInput(input);
  const startedAt = {};
  if (input.from) startedAt.gte = input.from;
  if (input.to) startedAt.lte = input.to;
  const where = {
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.finishedItemId !== undefined
      ? { finishedItemId: input.finishedItemId }
      : {}),
    ...(Object.keys(startedAt).length > 0 ? { startedAt } : {})
  };
  const [runs, total] = await Promise.all([
    db.productionRun.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      include: runInclude
    }),
    db.productionRun.count({ where })
  ]);
  return {
    items: runs.map(presentRunListItem),
    page: input.page,
    limit: input.limit,
    total
  };
}

export async function getRunDetails(db, runId) {
  assertPositiveInt(runId, 'id');
  const run = await db.productionRun.findUnique({
    where: { id: runId },
    include: runInclude
  });
  if (!run) {
    throw notFound('Production run not found');
  }

  const [ledgerRows, auditHistory] = await Promise.all([
    db.stockMovement.findMany({
      where: { sourceType: 'PRODUCTION_RUN', sourceId: run.id },
      orderBy: [{ movementDate: 'asc' }, { id: 'asc' }],
      include: {
        item: {
          select: {
            id: true,
            code: true,
            name: true,
            displayUnit: { select: { code: true } }
          }
        },
        createdBy: { select: { id: true, name: true } }
      }
    }),
    db.auditLog.findMany({
      where: { entity: 'ProductionRun', entityId: run.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { user: { select: { id: true, name: true } } }
    })
  ]);
  const variance = run.status === 'COMPLETED'
    ? computeRunVariance(run, run.lines)
    : null;
  const present = presentRun(run);

  return {
    ...present,
    lines: present.lines.map((line) => {
      const lineVariance = variance?.lines.find((entry) => entry.itemId === line.itemId);
      return {
        ...line,
        variance: lineVariance
          ? {
              bp: lineVariance.bp,
              pct: lineVariance.pct,
              flagged: lineVariance.flagged
            }
          : null
      };
    }),
    overheads: [],
    ledgerRows: ledgerRows.map((movement) => ({
      ...movement,
      itemName: movement.item.name,
      qtyChangeDisplay: formatQty(
        movement.qtyChange,
        movement.item.displayUnit.code
      )
    })),
    auditHistory
  };
}

export async function updateRun(userId, runId, input) {
  assertPositiveInt(userId, 'userId');
  assertPositiveInt(runId, 'runId');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Production run update must be an object');
  }
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.some((key) => !['notes', 'batchNo'].includes(key))) {
    throw badRequest('Only notes and batchNo can be updated');
  }
  if (input.notes !== undefined && input.notes !== null && typeof input.notes !== 'string') {
    throw badRequest('notes must be a string or null');
  }
  if (
    input.batchNo !== undefined &&
    input.batchNo !== null &&
    (typeof input.batchNo !== 'string' || input.batchNo.trim().length === 0)
  ) {
    throw badRequest('batchNo must be a non-empty string or null');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ProductionRun" WHERE id = ${runId} FOR UPDATE`;
    const before = await tx.productionRun.findUnique({
      where: { id: runId },
      include: runInclude
    });
    if (!before) {
      throw notFound('Production run not found');
    }
    if (before.status !== 'ISSUED' && before.status !== 'COMPLETED') {
      throw new AppError(409, 'RUN_NOT_EDITABLE', 'Production run cannot be edited', {
        runId,
        status: before.status
      });
    }

    const after = await tx.productionRun.update({
      where: { id: runId },
      data: input,
      include: runInclude
    });
    await writeAudit(tx, {
      userId,
      action: 'UPDATE',
      entity: 'ProductionRun',
      entityId: runId,
      before,
      after
    });
    return presentRun(after);
  }, { maxWait: 10000, timeout: 30000 });
}

export async function cancelRun(userId, runId, reason) {
  assertPositiveInt(userId, 'userId');
  assertPositiveInt(runId, 'runId');
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw badRequest('reason is required');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ProductionRun" WHERE id = ${runId} FOR UPDATE`;
    const before = await tx.productionRun.findUnique({
      where: { id: runId },
      include: runInclude
    });
    if (!before) {
      throw notFound('Production run not found');
    }
    if (before.status === 'COMPLETED') {
      throw new AppError(
        409,
        'RUN_COMPLETED',
        'Completed production runs cannot be cancelled; correct stock with an adjustment',
        { runId }
      );
    }
    if (before.status !== 'ISSUED') {
      throw new AppError(409, 'RUN_NOT_OPEN', 'Production run is not open for cancellation', {
        runId,
        status: before.status
      });
    }

    const issuedMovements = await tx.stockMovement.findMany({
      where: {
        sourceType: 'PRODUCTION_RUN',
        sourceId: runId,
        qtyChange: { lt: 0 }
      },
      orderBy: { id: 'asc' }
    });
    const reversalDate = new Date();
    const ledgerRows = [];
    for (const movement of issuedMovements) {
      ledgerRows.push(await addMovement(tx, {
        itemId: movement.itemId,
        qtyChange: -movement.qtyChange,
        movementType: 'ADJUSTMENT',
        sourceType: 'PRODUCTION_RUN',
        sourceId: runId,
        sourceRef: before.runNo,
        ratePaisePerBase: movement.ratePaisePerBase?.toString() ?? null,
        batchNo: movement.batchNo,
        expiryDate: movement.expiryDate,
        movementDate: reversalDate,
        userId,
        note: `Reversal: ${reason.trim()}`
      }));
    }

    const after = await tx.productionRun.update({
      where: { id: runId },
      data: { status: 'CANCELLED' },
      include: runInclude
    });
    await writeAudit(tx, {
      userId,
      action: 'CANCEL',
      entity: 'ProductionRun',
      entityId: runId,
      before,
      after: {
        ...after,
        cancellationReason: reason.trim(),
        reversedMovementIds: ledgerRows.map(({ id }) => id)
      }
    });
    return {
      ...presentRun(after),
      ledgerRows
    };
  }, { maxWait: 10000, timeout: 30000 });
}
