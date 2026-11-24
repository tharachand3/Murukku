import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { formatQty, toBase, UNITS } from '../lib/units.js';
import { batchesFromIssue, planFromBatches, planFromTargetOutput } from '../lib/bomMath.js';
import { prisma } from '../lib/prisma.js';
import { writeAudit } from '../lib/audit.js';

const INTEGER_MAX = 2147483647;
const LINE_TYPES = new Set(['RAW', 'PACKAGING']);

const bomInclude = {
  finishedItem: {
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
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

function assertPositiveInt(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > INTEGER_MAX) {
    throw badRequest(`${name} must be a positive PostgreSQL integer`);
  }
}

function presentBom(bom) {
  return {
    ...bom,
    lines: bom.lines.map((line) => ({
      ...line,
      itemName: line.item.name,
      qtyPerBatchDisplay: formatQty(line.qtyPerBatch, line.item.displayUnit.code)
    }))
  };
}

function assertUniqueItemIds(lines, name = 'lines') {
  const seen = new Set();
  for (const line of lines) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      throw badRequest(`Each ${name} entry must be an object`);
    }
    assertPositiveInt(line.itemId, 'itemId');
    if (seen.has(line.itemId)) {
      throw badRequest(`${name} cannot contain duplicate itemIds`, { itemId: line.itemId });
    }
    seen.add(line.itemId);
  }
}

function convertQuantity(qty, unit, item) {
  if (typeof unit !== 'string' || !Object.hasOwn(UNITS, unit)) {
    throw badRequest(`Unsupported unit "${unit}"`);
  }
  const unitInfo = UNITS[unit];
  if (unitInfo.dimension !== item.baseUnit.dimension) {
    throw badRequest(`Unit "${unit}" does not match ${item.name}'s base-unit dimension`);
  }

  let baseQty;
  try {
    baseQty = toBase(qty, unit);
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) {
      throw badRequest(error.message);
    }
    throw error;
  }
  assertPositiveInt(baseQty, 'qty');
  return baseQty;
}

async function normalizeLines(tx, lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw badRequest('At least one BOM line is required');
  }
  assertUniqueItemIds(lines);

  const items = await tx.item.findMany({
    where: { id: { in: lines.map(({ itemId }) => itemId) } },
    include: {
      baseUnit: { select: { code: true, dimension: true } }
    }
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  const normalized = [];

  for (const line of lines) {
    const item = byId.get(line.itemId);
    if (!item) {
      throw notFound(`BOM line item ${line.itemId} not found`);
    }
    if (!LINE_TYPES.has(item.type)) {
      throw badRequest(`BOM line item "${item.name}" must be RAW or PACKAGING`);
    }
    if (!item.isActive) {
      throw unprocessable(`BOM line item "${item.name}" is inactive`, { itemId: item.id });
    }
    normalized.push({
      itemId: item.id,
      qtyPerBatch: convertQuantity(line.qty, line.unit, item)
    });
  }
  return normalized;
}

async function validateStoredLines(tx, lines) {
  assertUniqueItemIds(lines);
  for (const line of lines) {
    assertPositiveInt(line.qtyPerBatch, 'qtyPerBatch');
  }
  const items = await tx.item.findMany({
    where: { id: { in: lines.map(({ itemId }) => itemId) } },
    select: { id: true, name: true, type: true, isActive: true }
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const line of lines) {
    const item = byId.get(line.itemId);
    if (!item) {
      throw notFound(`BOM line item ${line.itemId} not found`);
    }
    if (!LINE_TYPES.has(item.type)) {
      throw badRequest(`BOM line item "${item.name}" must be RAW or PACKAGING`);
    }
    if (!item.isActive) {
      throw unprocessable(`BOM line item "${item.name}" is inactive`, { itemId: item.id });
    }
  }
  return lines;
}

async function lockFinishedItem(tx, finishedItemId) {
  assertPositiveInt(finishedItemId, 'finishedItemId');
  const locked = await tx.$queryRaw`
    SELECT id FROM "Item" WHERE id = ${finishedItemId} FOR UPDATE
  `;
  if (locked.length === 0) {
    throw notFound('Finished item not found');
  }
  const item = await tx.item.findUnique({
    where: { id: finishedItemId },
    select: { id: true, name: true, type: true, isActive: true }
  });
  if (item.type !== 'FINISHED') {
    throw badRequest(`Item "${item.name}" must be FINISHED`);
  }
  if (!item.isActive) {
    throw unprocessable(`Finished item "${item.name}" is inactive`, { finishedItemId });
  }
  return item;
}

async function deactivateActiveBoms(tx, userId, finishedItemId) {
  const activeBoms = await tx.bom.findMany({
    where: { finishedItemId, isActive: true },
    include: bomInclude
  });
  for (const before of activeBoms) {
    const after = await tx.bom.update({
      where: { id: before.id },
      data: { isActive: false },
      include: bomInclude
    });
    await writeAudit(tx, {
      userId,
      action: 'UPDATE',
      entity: 'Bom',
      entityId: before.id,
      before,
      after
    });
  }
}

async function createVersion(tx, userId, data) {
  await lockFinishedItem(tx, data.finishedItemId);
  const latest = await tx.bom.aggregate({
    where: { finishedItemId: data.finishedItemId },
    _max: { version: true }
  });
  const version = (latest._max.version ?? 0) + 1;
  if (version > INTEGER_MAX) {
    throw conflict('BOM version limit reached', { finishedItemId: data.finishedItemId });
  }

  await deactivateActiveBoms(tx, userId, data.finishedItemId);
  const bom = await tx.bom.create({
    data: {
      name: data.name,
      finishedItemId: data.finishedItemId,
      version,
      isActive: true,
      batchYieldQty: data.batchYieldQty,
      notes: data.notes ?? null,
      lines: { create: data.lines }
    },
    include: bomInclude
  });
  await writeAudit(tx, {
    userId,
    action: 'CREATE',
    entity: 'Bom',
    entityId: bom.id,
    after: bom
  });
  return bom;
}

async function findBom(db, id) {
  assertPositiveInt(id, 'id');
  const bom = await db.bom.findUnique({
    where: { id },
    include: bomInclude
  });
  if (!bom) {
    throw notFound('BOM not found');
  }
  return bom;
}

export async function listBoms(db, { finishedItemId, active }) {
  if (finishedItemId !== undefined) {
    assertPositiveInt(finishedItemId, 'finishedItemId');
  }
  const boms = await db.bom.findMany({
    where: {
      ...(finishedItemId !== undefined ? { finishedItemId } : {}),
      ...(active !== undefined ? { isActive: active } : {})
    },
    orderBy: [{ finishedItemId: 'asc' }, { version: 'desc' }],
    include: bomInclude
  });
  return boms.map(presentBom);
}

export async function getBom(db, id) {
  return presentBom(await findBom(db, id));
}

export async function planBom(db, bomId, query) {
  const bom = await findBom(db, bomId);
  const hasBatches = query.batches !== undefined;
  const hasTargetOutput = query.targetOutput !== undefined;
  const hasIssueFields = ['itemId', 'qty', 'unit'].some(
    (field) => query[field] !== undefined
  );
  const hasCompleteIssue = query.itemId !== undefined &&
    query.qty !== undefined &&
    query.unit !== undefined;
  if (
    Number(hasBatches) + Number(hasTargetOutput) + Number(hasIssueFields) !== 1 ||
    (hasIssueFields && !hasCompleteIssue)
  ) {
    throw badRequest('Provide exactly one planning mode: batches, targetOutput, or itemId/qty/unit');
  }

  let planned;
  try {
    if (hasBatches) {
      planned = planFromBatches(bom, query.batches);
    } else if (hasTargetOutput) {
      planned = planFromTargetOutput(bom, query.targetOutput);
    } else {
      const line = bom.lines.find(({ itemId }) => itemId === query.itemId);
      if (!line) {
        throw badRequest(`Item ${query.itemId} is not in this BOM`);
      }
      const issuedQty = convertQuantity(query.qty, query.unit, line.item);
      planned = batchesFromIssue(bom, query.itemId, issuedQty);
    }
  } catch (error) {
    if (error instanceof RangeError) {
      throw badRequest(error.message);
    }
    throw error;
  }

  const linesByItemId = new Map(bom.lines.map((line) => [line.itemId, line]));
  return {
    batchCount: planned.batchCount.toString(),
    plannedOutputQty: planned.plannedOutputQty,
    lines: planned.lines.map((line) => {
      const bomLine = linesByItemId.get(line.itemId);
      return {
        itemId: line.itemId,
        itemName: bomLine.item.name,
        plannedQty: line.plannedQty,
        plannedQtyDisplay: formatQty(line.plannedQty, bomLine.item.displayUnit.code)
      };
    })
  };
}

export async function createBom(userId, input) {
  return prisma.$transaction(async (tx) => {
    const lines = await normalizeLines(tx, input.lines);
    assertPositiveInt(input.batchYieldQty, 'batchYieldQty');
    const bom = await createVersion(tx, userId, { ...input, lines });
    return presentBom(bom);
  });
}

export async function updateBom(userId, id, input) {
  assertPositiveInt(id, 'id');
  return prisma.$transaction(async (tx) => {
    const existing = await tx.bom.findUnique({
      where: { id },
      select: { finishedItemId: true }
    });
    if (!existing) {
      throw notFound('BOM not found');
    }
    await lockFinishedItem(tx, existing.finishedItemId);
    await tx.$queryRaw`SELECT id FROM "Bom" WHERE id = ${id} FOR UPDATE`;

    const before = await tx.bom.findUnique({
      where: { id },
      include: bomInclude
    });
    if (!before) {
      throw notFound('BOM not found');
    }
    const lines = await normalizeLines(tx, input.lines);
    assertPositiveInt(input.batchYieldQty, 'batchYieldQty');
    const runCount = await tx.productionRun.count({ where: { bomId: id } });

    if (runCount > 0) {
      const newBom = await createVersion(tx, userId, {
        name: input.name,
        finishedItemId: before.finishedItemId,
        batchYieldQty: input.batchYieldQty,
        notes: input.notes === undefined ? before.notes : input.notes,
        lines
      });
      return presentBom(newBom);
    }

    const after = await tx.bom.update({
      where: { id },
      data: {
        name: input.name,
        batchYieldQty: input.batchYieldQty,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        lines: {
          deleteMany: {},
          create: lines
        }
      },
      include: bomInclude
    });
    await writeAudit(tx, {
      userId,
      action: 'UPDATE',
      entity: 'Bom',
      entityId: id,
      before,
      after
    });
    return presentBom(after);
  });
}

export async function cloneBom(userId, id, input) {
  assertPositiveInt(id, 'id');
  return prisma.$transaction(async (tx) => {
    const source = await tx.bom.findUnique({
      where: { id },
      include: bomInclude
    });
    if (!source) {
      throw notFound('BOM not found');
    }
    if (input.finishedItemId === source.finishedItemId) {
      throw badRequest('Clone target must be a different finished item');
    }
    await lockFinishedItem(tx, input.finishedItemId);

    const lines = new Map(source.lines.map((line) => [
      line.itemId,
      { itemId: line.itemId, qtyPerBatch: line.qtyPerBatch }
    ]));
    const replacedIds = new Set();
    for (const replacement of input.replaceItems) {
      if (replacedIds.has(replacement.fromItemId)) {
        throw badRequest('replaceItems cannot contain duplicate fromItemIds');
      }
      replacedIds.add(replacement.fromItemId);
      if (!lines.has(replacement.fromItemId)) {
        throw badRequest(`Cannot replace item ${replacement.fromItemId}: it is not in the source BOM`);
      }
      const replacementLine = (await normalizeLines(tx, [{
        itemId: replacement.toItemId,
        qty: replacement.qty,
        unit: replacement.unit
      }]))[0];
      lines.delete(replacement.fromItemId);
      if (lines.has(replacementLine.itemId)) {
        throw badRequest(`Clone would contain duplicate item ${replacementLine.itemId}`);
      }
      lines.set(replacementLine.itemId, replacementLine);
    }

    const overriddenIds = new Set();
    for (const override of input.lineOverrides) {
      if (overriddenIds.has(override.itemId)) {
        throw badRequest('lineOverrides cannot contain duplicate itemIds');
      }
      overriddenIds.add(override.itemId);
      if (!lines.has(override.itemId)) {
        throw badRequest(`Cannot override item ${override.itemId}: it is not in the cloned BOM`);
      }
      const overrideLine = (await normalizeLines(tx, [override]))[0];
      lines.set(override.itemId, overrideLine);
    }

    const normalizedLines = await validateStoredLines(tx, [...lines.values()]);
    const batchYieldQty = input.batchYieldQty ?? source.batchYieldQty;
    assertPositiveInt(batchYieldQty, 'batchYieldQty');
    const bom = await createVersion(tx, userId, {
      name: input.name,
      finishedItemId: input.finishedItemId,
      batchYieldQty,
      notes: source.notes,
      lines: normalizedLines
    });
    return presentBom(bom);
  });
}
