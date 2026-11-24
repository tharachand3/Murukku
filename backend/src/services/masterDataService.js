import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { STATES } from '../lib/states.js';
import { getBalance } from './ledgerService.js';

const ITEM_TYPES = ['RAW', 'PACKAGING', 'FINISHED'];
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const POSTGRES_INT_MAX = 2147483647;

const itemInclude = {
  baseUnit: { select: { id: true, code: true, name: true, dimension: true } },
  displayUnit: { select: { id: true, code: true, name: true, dimension: true } }
};
const customerInclude = {
  assignedSalesman: { select: { id: true, name: true } }
};
const customerPriceInclude = {
  item: { select: { id: true, code: true, name: true, type: true } }
};

function assertPositiveId(id, name) {
  if (!Number.isSafeInteger(id) || id <= 0 || id > POSTGRES_INT_MAX) {
    throw badRequest(`${name} must be a positive integer`);
  }
}

function validateGstin(gstin, stateCode) {
  if (gstin === undefined || gstin === null) {
    return gstin;
  }
  const normalized = gstin.trim().toUpperCase();
  if (!GSTIN_PATTERN.test(normalized)) {
    throw badRequest('GSTIN must be a valid 15-character GSTIN');
  }
  if (stateCode && normalized.slice(0, 2) !== stateCode) {
    throw badRequest('GSTIN state code must match stateCode');
  }
  return normalized;
}

async function validateItem(tx, item) {
  if (!ITEM_TYPES.includes(item.type)) {
    throw badRequest('type must be RAW, PACKAGING, or FINISHED');
  }
  if (!Number.isInteger(item.gstRateBp) || item.gstRateBp < 0 || item.gstRateBp > 2800) {
    throw badRequest('gstRateBp must be between 0 and 2800');
  }
  assertPositiveId(item.baseUnitId, 'baseUnitId');
  assertPositiveId(item.displayUnitId, 'displayUnitId');

  const units = await tx.unit.findMany({
    where: { id: { in: [item.baseUnitId, item.displayUnitId] } },
    select: { id: true, dimension: true }
  });
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const baseUnit = unitById.get(item.baseUnitId);
  const displayUnit = unitById.get(item.displayUnitId);
  if (!baseUnit || !displayUnit) {
    throw badRequest('baseUnitId and displayUnitId must reference existing units');
  }
  if (baseUnit.dimension !== displayUnit.dimension) {
    throw badRequest('baseUnit and displayUnit must have the same dimension');
  }
  if (
    item.type !== 'FINISHED' &&
    (item.packsPerCarton !== undefined && item.packsPerCarton !== null ||
      item.sellingPricePaise !== undefined && item.sellingPricePaise !== null)
  ) {
    throw badRequest('packsPerCarton and sellingPricePaise are only valid for finished goods');
  }
}

export async function listItems(db, { type, active }) {
  const items = await db.item.findMany({
    where: {
      ...(type !== undefined ? { type } : {}),
      ...(active !== undefined ? { isActive: active } : {})
    },
    orderBy: { code: 'asc' },
    include: itemInclude
  });
  return items;
}

export async function getItem(db, id) {
  assertPositiveId(id, 'id');
  const item = await db.item.findUnique({
    where: { id },
    include: itemInclude
  });
  if (!item) {
    throw notFound('Item not found');
  }
  return item;
}

export async function createItem(userId, input) {
  return prisma.$transaction(async (tx) => {
    await validateItem(tx, input);
    const item = await tx.item.create({
      data: input,
      include: itemInclude
    });
    await writeAudit(tx, {
      userId,
      action: 'CREATE',
      entity: 'Item',
      entityId: item.id,
      after: item
    });
    return item;
  });
}

export async function updateItem(userId, id, input) {
  assertPositiveId(id, 'id');
  return prisma.$transaction(async (tx) => {
    const before = await tx.item.findUnique({
      where: { id },
      include: itemInclude
    });
    if (!before) {
      throw notFound('Item not found');
    }

    const merged = { ...before, ...input };
    await validateItem(tx, merged);

    if (input.baseUnitId !== undefined && input.baseUnitId !== before.baseUnitId) {
      const movementCount = await tx.stockMovement.count({ where: { itemId: id } });
      if (movementCount > 0) {
        throw conflict('Cannot change an item base unit after stock movements exist', { itemId: id });
      }
    }
    if (input.isActive === false && before.isActive) {
      const balance = await getBalance(tx, id);
      if (balance !== 0) {
        throw conflict('Cannot deactivate an item with non-zero stock', {
          itemId: id,
          balanceBase: balance
        });
      }
    }

    const after = await tx.item.update({
      where: { id },
      data: input,
      include: itemInclude
    });
    await writeAudit(tx, {
      userId,
      action: 'UPDATE',
      entity: 'Item',
      entityId: id,
      before,
      after
    });
    return after;
  });
}

async function validateCustomer(tx, customer) {
  if (!Object.hasOwn(STATES, customer.stateCode)) {
    throw badRequest('stateCode must be a supported two-digit state code');
  }
  const gstin = validateGstin(customer.gstin, customer.stateCode);

  if (customer.assignedSalesmanId !== undefined && customer.assignedSalesmanId !== null) {
    assertPositiveId(customer.assignedSalesmanId, 'assignedSalesmanId');
    const salesman = await tx.user.findUnique({
      where: { id: customer.assignedSalesmanId },
      select: { id: true, role: true, isActive: true }
    });
    if (!salesman || salesman.role !== 'SALESMAN' || !salesman.isActive) {
      throw badRequest('assignedSalesmanId must identify an active SALESMAN');
    }
  }

  return { ...customer, gstin, stateName: STATES[customer.stateCode] };
}

function assertCustomerAccess(customer, user) {
  if (
    user.role === 'SALESMAN' &&
    customer.assignedSalesmanId !== user.id
  ) {
    throw notFound('Customer not found');
  }
}

export async function listCustomers(db, user, { type, active }) {
  return db.customer.findMany({
    where: {
      ...(type !== undefined ? { type } : {}),
      ...(active !== undefined ? { isActive: active } : {}),
      ...(user.role === 'SALESMAN' ? { assignedSalesmanId: user.id } : {})
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    include: customerInclude
  });
}

export async function getCustomer(db, id, user) {
  assertPositiveId(id, 'id');
  const customer = await db.customer.findUnique({
    where: { id },
    include: customerInclude
  });
  if (!customer) {
    throw notFound('Customer not found');
  }
  assertCustomerAccess(customer, user);
  return customer;
}

export async function createCustomer(userId, input) {
  return prisma.$transaction(async (tx) => {
    const data = await validateCustomer(tx, input);
    const customer = await tx.customer.create({
      data,
      include: customerInclude
    });
    await writeAudit(tx, {
      userId,
      action: 'CREATE',
      entity: 'Customer',
      entityId: customer.id,
      after: customer
    });
    return customer;
  });
}

export async function updateCustomer(userId, id, input) {
  assertPositiveId(id, 'id');
  return prisma.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({
      where: { id },
      include: customerInclude
    });
    if (!before) {
      throw notFound('Customer not found');
    }
    const data = await validateCustomer(tx, { ...before, ...input });
    const after = await tx.customer.update({
      where: { id },
      data: {
        ...input,
        gstin: data.gstin,
        stateCode: data.stateCode,
        stateName: data.stateName
      },
      include: customerInclude
    });
    await writeAudit(tx, {
      userId,
      action: 'UPDATE',
      entity: 'Customer',
      entityId: id,
      before,
      after
    });
    return after;
  });
}

export async function getCustomerPrices(db, customerId, user) {
  assertPositiveId(customerId, 'customerId');
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, assignedSalesmanId: true }
  });
  if (!customer) {
    throw notFound('Customer not found');
  }
  assertCustomerAccess(customer, user);
  return db.customerPrice.findMany({
    where: { customerId },
    orderBy: { item: { code: 'asc' } },
    include: customerPriceInclude
  });
}

export async function putCustomerPrices(userId, customerId, prices) {
  assertPositiveId(customerId, 'customerId');
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { id: true, isActive: true }
    });
    if (!customer) {
      throw notFound('Customer not found');
    }
    if (!customer.isActive) {
      throw unprocessable('Cannot set prices for an inactive customer', { customerId });
    }

    const items = await tx.item.findMany({
      where: { id: { in: prices.map(({ itemId }) => itemId) } },
      select: { id: true, isActive: true }
    });
    const activeItemIds = new Set(items.filter((item) => item.isActive).map((item) => item.id));
    for (const { itemId } of prices) {
      if (!activeItemIds.has(itemId)) {
        throw notFound(`Active item ${itemId} not found`);
      }
    }

    const savedPrices = [];
    for (const price of prices) {
      const where = {
        customerId_itemId: { customerId, itemId: price.itemId }
      };
      const before = await tx.customerPrice.findUnique({ where });
      const after = await tx.customerPrice.upsert({
        where,
        update: { pricePaise: price.pricePaise },
        create: { customerId, ...price },
        include: customerPriceInclude
      });
      await writeAudit(tx, {
        userId,
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'CustomerPrice',
        entityId: after.id,
        before,
        after
      });
      savedPrices.push(after);
    }
    return savedPrices;
  });
}

async function validateSupplier(supplier) {
  if (supplier.stateCode !== undefined && supplier.stateCode !== null) {
    if (!Object.hasOwn(STATES, supplier.stateCode)) {
      throw badRequest('stateCode must be a supported two-digit state code');
    }
  }
  const gstin = validateGstin(supplier.gstin, supplier.stateCode);
  return { ...supplier, gstin };
}

export async function listSuppliers(db, { active }) {
  return db.supplier.findMany({
    where: active !== undefined ? { isActive: active } : {},
    orderBy: [{ name: 'asc' }, { id: 'asc' }]
  });
}

export async function getSupplier(db, id) {
  assertPositiveId(id, 'id');
  const supplier = await db.supplier.findUnique({ where: { id } });
  if (!supplier) {
    throw notFound('Supplier not found');
  }
  return supplier;
}

export async function createSupplier(userId, input) {
  return prisma.$transaction(async (tx) => {
    const data = await validateSupplier(input);
    const supplier = await tx.supplier.create({ data });
    await writeAudit(tx, {
      userId,
      action: 'CREATE',
      entity: 'Supplier',
      entityId: supplier.id,
      after: supplier
    });
    return supplier;
  });
}

export async function updateSupplier(userId, id, input) {
  assertPositiveId(id, 'id');
  return prisma.$transaction(async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id } });
    if (!before) {
      throw notFound('Supplier not found');
    }
    const data = await validateSupplier({ ...before, ...input });
    const after = await tx.supplier.update({
      where: { id },
      data: { ...input, gstin: data.gstin, stateCode: data.stateCode }
    });
    await writeAudit(tx, {
      userId,
      action: 'UPDATE',
      entity: 'Supplier',
      entityId: id,
      before,
      after
    });
    return after;
  });
}
