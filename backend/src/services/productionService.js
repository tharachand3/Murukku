import Decimal from 'decimal.js';
import { writeAudit } from '../lib/audit.js';
import { planFromBatches } from '../lib/bomMath.js';
import { badRequest, notFound } from '../lib/errors.js';
import { mulRateQty, paiseToRupeesString } from '../lib/money.js';
import { formatQty, toBase, UNITS } from '../lib/units.js';
import { prisma } from '../lib/prisma.js';
import { addMovement } from './ledgerService.js';
import { nextNumber } from './numberingService.js';
import { getAverageRate } from './costingService.js';

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
      issuedQtyDisplay: formatQty(line.issuedQty, line.item.displayUnit.code)
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
