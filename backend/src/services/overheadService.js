import { z } from 'zod';
import { writeAudit } from '../lib/audit.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { paiseToRupeesString } from '../lib/money.js';
import { prisma } from '../lib/prisma.js';
import { computeRunCost, formatPaiseDecimalAsRupees } from '../lib/costMath.js';

const INTEGER_MAX = 2147483647;
const amountLimit = 1000000000;

export const overheadInputSchema = z.object({
  kind: z.enum(['LABOUR', 'POWER_GAS', 'OTHER']),
  amountPaise: z.number().int().min(1).max(amountLimit),
  note: z.string().max(200).optional()
}).strict();

const kindLabels = Object.freeze({
  LABOUR: 'Labour',
  POWER_GAS: 'Power / gas',
  OTHER: 'Other'
});

function assertPositiveInt(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > INTEGER_MAX) {
    throw badRequest(`${name} must be a positive PostgreSQL integer`);
  }
}

function assertAmountTotal(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > INTEGER_MAX) {
    throw new AppError(422, 'OVERHEAD_TOTAL_RANGE', 'Run overhead total exceeds the supported range');
  }
}

function displayOverhead(row) {
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: kindLabels[row.kind],
    amountPaise: row.amountPaise,
    amountDisplay: `Rs ${paiseToRupeesString(row.amountPaise)}`,
    note: row.note
  };
}

function costFields(run) {
  return {
    overheadCostPaise: run.overheadCostPaise,
    costPerPacketPaise: run.costPerPacketPaise?.toFixed(4) ?? null
  };
}

export async function recalcRunCost(db, runId) {
  assertPositiveInt(runId, 'runId');
  const run = await db.productionRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      materialCostPaise: true,
      overheadCostPaise: true,
      costPerPacketPaise: true,
      status: true,
      actualGoodQty: true
    }
  });
  if (!run) {
    throw notFound('Production run not found');
  }

  const overheads = await db.productionOverhead.findMany({
    where: { runId },
    select: { amountPaise: true }
  });
  const overheadCostPaise = overheads.reduce((total, overhead) => {
    const next = total + overhead.amountPaise;
    assertAmountTotal(next);
    return next;
  }, 0);
  const materialCostPaise = run.materialCostPaise ?? 0;
  const cost = computeRunCost({
    materialCostPaise,
    overheadCostPaise,
    goodQty: run.status === 'COMPLETED' ? run.actualGoodQty : null
  });
  const updatedRun = await db.productionRun.update({
    where: { id: runId },
    data: {
      overheadCostPaise,
      costPerPacketPaise: cost.costPerPacketPaise
    }
  });

  return {
    run: updatedRun,
    totalCostPaise: cost.totalCostPaise,
    costPerPacketPaise: cost.costPerPacketPaise
  };
}

export async function addOverhead(user, runId, input) {
  assertPositiveInt(user?.id, 'userId');
  assertPositiveInt(runId, 'runId');
  const parsed = overheadInputSchema.safeParse(input);
  if (!parsed.success) {
    throw badRequest('Invalid production overhead', parsed.error.flatten());
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ProductionRun" WHERE id = ${runId} FOR UPDATE`;
    const before = await tx.productionRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        runNo: true,
        status: true,
        overheadCostPaise: true,
        costPerPacketPaise: true
      }
    });
    if (!before) {
      throw notFound('Production run not found');
    }
    if (before.status === 'CANCELLED') {
      throw new AppError(409, 'RUN_CANCELLED', 'Cancelled production runs cannot have overheads', {
        runId
      });
    }
    if (!['ISSUED', 'COMPLETED'].includes(before.status)) {
      throw new AppError(409, 'RUN_NOT_EDITABLE', 'Production run cannot have overheads', {
        runId,
        status: before.status
      });
    }

    const row = await tx.productionOverhead.create({
      data: { runId, ...parsed.data }
    });
    const recalculated = await recalcRunCost(tx, runId);
    await writeAudit(tx, {
      userId: user.id,
      action: 'CREATE',
      entity: 'ProductionOverhead',
      entityId: row.id,
      after: row
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'UPDATE',
      entity: 'ProductionRun',
      entityId: runId,
      before: costFields(before),
      after: costFields(recalculated.run)
    });

    return {
      overhead: displayOverhead(row),
      cost: await getRunCostSnapshot(tx, runId)
    };
  }, { maxWait: 10000, timeout: 30000 });
}

export async function deleteOverhead(user, runId, overheadId) {
  assertPositiveInt(user?.id, 'userId');
  assertPositiveInt(runId, 'runId');
  assertPositiveInt(overheadId, 'overheadId');

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ProductionRun" WHERE id = ${runId} FOR UPDATE`;
    const beforeRun = await tx.productionRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        status: true,
        overheadCostPaise: true,
        costPerPacketPaise: true
      }
    });
    if (!beforeRun) {
      throw notFound('Production run not found');
    }
    if (beforeRun.status === 'CANCELLED') {
      throw new AppError(409, 'RUN_CANCELLED', 'Cancelled production runs cannot have overheads', {
        runId
      });
    }
    if (!['ISSUED', 'COMPLETED'].includes(beforeRun.status)) {
      throw new AppError(409, 'RUN_NOT_EDITABLE', 'Production run cannot have overheads', {
        runId,
        status: beforeRun.status
      });
    }

    const row = await tx.productionOverhead.findFirst({
      where: { id: overheadId, runId }
    });
    if (!row) {
      throw notFound('Production overhead not found');
    }
    await tx.productionOverhead.delete({ where: { id: overheadId } });
    const recalculated = await recalcRunCost(tx, runId);
    await writeAudit(tx, {
      userId: user.id,
      action: 'DELETE',
      entity: 'ProductionOverhead',
      entityId: row.id,
      before: row
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'UPDATE',
      entity: 'ProductionRun',
      entityId: runId,
      before: costFields(beforeRun),
      after: costFields(recalculated.run)
    });

    return { cost: await getRunCostSnapshot(tx, runId) };
  }, { maxWait: 10000, timeout: 30000 });
}

export async function listOverheads(db, runId) {
  assertPositiveInt(runId, 'runId');
  const run = await db.productionRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      overheads: {
        orderBy: { id: 'asc' }
      }
    }
  });
  if (!run) {
    throw notFound('Production run not found');
  }

  const rows = run.overheads.map(displayOverhead);
  const totalPaise = rows.reduce((total, row) => total + row.amountPaise, 0);
  assertAmountTotal(totalPaise);
  return {
    rows,
    totalPaise,
    totalDisplay: `Rs ${paiseToRupeesString(totalPaise)}`
  };
}

export async function getRunCostSnapshot(db, runId) {
  assertPositiveInt(runId, 'runId');
  const run = await db.productionRun.findUnique({
    where: { id: runId },
    select: {
      runNo: true,
      status: true,
      actualGoodQty: true,
      materialCostPaise: true,
      overheadCostPaise: true,
      costPerPacketPaise: true
    }
  });
  if (!run) {
    throw notFound('Production run not found');
  }

  const materialCostPaise = run.materialCostPaise ?? 0;
  const overheadCostPaise = run.overheadCostPaise ?? 0;
  const totalCostPaise = materialCostPaise + overheadCostPaise;
  if (!Number.isSafeInteger(totalCostPaise) || totalCostPaise < 0) {
    throw new AppError(422, 'RUN_COST_RANGE', 'Run total cost exceeds the supported range');
  }
  const costPerPacketPaise = run.costPerPacketPaise?.toFixed(4) ?? null;
  return {
    runNo: run.runNo,
    status: run.status,
    goodQty: run.actualGoodQty,
    materialCostPaise,
    overheadCostPaise,
    totalCostPaise,
    costPerPacketPaise,
    costPerPacketDisplay: costPerPacketPaise === null
      ? null
      : formatPaiseDecimalAsRupees(costPerPacketPaise)
  };
}
