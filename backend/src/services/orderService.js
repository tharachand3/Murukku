import { AppError, badRequest, conflict } from '../lib/errors.js';
import { lineTaxablePaise, orderTaxablePaise } from '../lib/orderMath.js';
import { paiseToRupeesString } from '../lib/money.js';
import { writeAudit } from '../lib/audit.js';
import { getCustomer } from './masterDataService.js';
import { nextNumber } from './numberingService.js';
import { resolvePrices } from './pricingService.js';
import { prisma } from '../lib/prisma.js';
import { effectivePricePaise, effectiveQty } from '../lib/orderMath.js';
import { formatQty } from '../lib/units.js';
import { notFound } from '../lib/errors.js';
import { istDayRange } from '../lib/istDate.js';

const ORDER_STATUS_LABELS = Object.freeze({
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  INVOICED: 'Invoiced',
  DISPATCHED: 'Dispatched',
  CANCELLED: 'Cancelled'
});

function addSafeIntegers(left, right, name) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${name} exceeds the supported range`);
  }
  return result;
}

function orderTotalQty(lines) {
  return lines.reduce(
    (total, line) => addSafeIntegers(total, effectiveQty(line), 'Order quantity'),
    0
  );
}

function orderDateFilter(from, to) {
  const { gte, lt } = istDayRange(from, to);
  const createdAt = {};
  if (gte) createdAt.gte = gte;
  if (lt) createdAt.lt = lt;
  return Object.keys(createdAt).length > 0 ? { createdAt } : {};
}

function presentOrderListItem(order, includeSalesman) {
  const taxableTotalPaise = orderTaxablePaise(order.lines);
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status],
    customerName: order.customer.name,
    ...(includeSalesman ? { salesmanName: order.salesman.name } : {}),
    createdAt: order.createdAt,
    lineCount: order.lines.length,
    totalQty: orderTotalQty(order.lines),
    taxableTotalPaise,
    display: paiseToRupeesString(taxableTotalPaise)
  };
}

export async function listOrders(db, input, user) {
  const isSalesman = user.role === 'SALESMAN';
  const where = {
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    ...(isSalesman
      ? { salesmanId: user.id }
      : input.salesmanId !== undefined
        ? { salesmanId: input.salesmanId }
        : {}),
    ...orderDateFilter(input.from, input.to),
    ...(input.q !== undefined
      ? { orderNo: { contains: input.q, mode: 'insensitive' } }
      : {})
  };
  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      include: {
        customer: { select: { name: true } },
        ...(isSalesman ? {} : { salesman: { select: { name: true } } }),
        lines: {
          select: {
            qty: true,
            pricePaise: true,
            approvedQty: true,
            approvedPricePaise: true
          }
        }
      }
    }),
    db.order.count({ where })
  ]);
  return {
    items: orders.map((order) => presentOrderListItem(order, !isSalesman)),
    page: input.page,
    limit: input.limit,
    total
  };
}

export async function listCustomerSales(db, user, input) {
  const where = {
    salesmanId: user.id,
    status: { notIn: ['REJECTED', 'CANCELLED'] },
    ...orderDateFilter(input.from, input.to)
  };
  const orders = await db.order.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      customer: { select: { id: true, name: true } },
      lines: {
        select: {
          qty: true,
          pricePaise: true,
          approvedQty: true,
          approvedPricePaise: true
        }
      }
    }
  });
  const customerSales = new Map();
  let totalOrders = 0;
  let totalQty = 0;
  let taxableValuePaise = 0;

  for (const order of orders) {
    const orderQty = orderTotalQty(order.lines);
    const orderValue = orderTaxablePaise(order.lines);
    const current = customerSales.get(order.customerId) ?? {
      customerId: order.customer.id,
      customerName: order.customer.name,
      orders: 0,
      totalQty: 0,
      taxableValuePaise: 0,
      lastOrderAt: order.createdAt
    };
    current.orders = addSafeIntegers(current.orders, 1, 'Order count');
    current.totalQty = addSafeIntegers(current.totalQty, orderQty, 'Customer quantity');
    current.taxableValuePaise = addSafeIntegers(
      current.taxableValuePaise,
      orderValue,
      'Customer taxable value'
    );
    if (order.createdAt > current.lastOrderAt) {
      current.lastOrderAt = order.createdAt;
    }
    customerSales.set(order.customerId, current);
    totalOrders = addSafeIntegers(totalOrders, 1, 'Total order count');
    totalQty = addSafeIntegers(totalQty, orderQty, 'Total quantity');
    taxableValuePaise = addSafeIntegers(
      taxableValuePaise,
      orderValue,
      'Total taxable value'
    );
  }

  const items = [...customerSales.values()]
    .map((item) => ({
      ...item,
      display: paiseToRupeesString(item.taxableValuePaise)
    }))
    .sort((left, right) =>
      right.taxableValuePaise - left.taxableValuePaise ||
      left.customerName.localeCompare(right.customerName)
    );

  return {
    items,
    totals: {
      orders: totalOrders,
      totalQty,
      taxableValuePaise,
      display: paiseToRupeesString(taxableValuePaise)
    }
  };
}

function presentOrderDetailLine(line) {
  const qty = line.qty;
  const pricePaise = line.pricePaise;
  const effectiveQtyValue = effectiveQty(line);
  const effectivePrice = effectivePricePaise(line);
  const approvedQtyDisplay = line.approvedQty === null
    ? null
    : formatQty(line.approvedQty, line.item.baseUnit.code);
  const approvedPriceDisplay = line.approvedPricePaise === null
    ? null
    : `Rs ${paiseToRupeesString(line.approvedPricePaise)}`;
  const lineTotalPaise = lineTaxablePaise(line);

  return {
    lineId: line.id,
    itemId: line.itemId,
    name: line.item.name,
    qty,
    qtyDisplay: formatQty(qty, line.item.baseUnit.code),
    pricePaise,
    priceDisplay: `Rs ${paiseToRupeesString(pricePaise)}`,
    approvedQty: line.approvedQty,
    approvedQtyDisplay,
    approvedPricePaise: line.approvedPricePaise,
    approvedPriceDisplay,
    effectiveQty: effectiveQtyValue,
    effectiveQtyDisplay: formatQty(effectiveQtyValue, line.item.baseUnit.code),
    effectivePricePaise: effectivePrice,
    effectivePriceDisplay: `Rs ${paiseToRupeesString(effectivePrice)}`,
    lineTotalPaise,
    lineTotalDisplay: paiseToRupeesString(lineTotalPaise)
  };
}

function auditNote(entry) {
  return entry.after?.rejectReason ??
    entry.after?.notes ??
    entry.before?.rejectReason ??
    entry.before?.notes ??
    null;
}

export async function getOrderDetails(db, orderId, user) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || orderId > POSTGRES_INT_MAX) {
    throw badRequest('id must be a positive integer');
  }
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { id: true, name: true } },
      salesman: { select: { id: true, name: true } },
      lines: {
        orderBy: { id: 'asc' },
        include: {
          item: {
            select: {
              id: true,
              name: true,
              baseUnit: { select: { code: true } }
            }
          }
        }
      },
      invoice: {
        select: {
          id: true,
          invoiceNo: true,
          status: true,
          totalPaise: true,
          dispatches: {
            orderBy: [{ dispatchDate: 'asc' }, { id: 'asc' }],
            select: { dispatchNo: true, dispatchDate: true }
          }
        }
      }
    }
  });
  if (!order || (user.role === 'SALESMAN' && order.salesmanId !== user.id)) {
    throw notFound('Order not found');
  }

  const auditRows = await db.auditLog.findMany({
    where: { entity: 'Order', entityId: order.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { user: { select: { name: true } } }
  });
  const lines = order.lines.map(presentOrderDetailLine);
  const taxableTotalPaise = orderTaxablePaise(order.lines);

  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status],
    customer: order.customer,
    salesman: order.salesman,
    notes: order.notes,
    rejectReason: order.rejectReason,
    createdAt: order.createdAt,
    lines,
    taxableTotalPaise,
    taxableTotalDisplay: paiseToRupeesString(taxableTotalPaise),
    invoice: order.invoice
      ? {
          id: order.invoice.id,
          invoiceNo: order.invoice.invoiceNo,
          status: order.invoice.status,
          totalPaise: order.invoice.totalPaise
        }
      : null,
    dispatches: order.invoice?.dispatches ?? [],
    timeline: auditRows.map((entry) => ({
      at: entry.createdAt,
      action: entry.action,
      by: entry.user?.name ?? null,
      note: auditNote(entry)
    }))
  };
}

const POSTGRES_INT_MAX = 2147483647;
const orderInclude = {
  customer: { select: { id: true, name: true } },
  lines: {
    orderBy: { id: 'asc' },
    include: { item: { select: { id: true, name: true } } }
  }
};

function assertUser(user) {
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 ||
      user.id > POSTGRES_INT_MAX) {
    throw badRequest('user must have a valid id');
  }
}

function mergeLines(lines) {
  const merged = new Map();
  for (const line of lines) {
    const existing = merged.get(line.itemId);
    if (existing) {
      existing.qty += line.qty;
    } else {
      merged.set(line.itemId, { itemId: line.itemId, qty: line.qty });
    }
  }
  return [...merged.values()];
}

function presentOrder(order) {
  const lines = order.lines.map((line) => ({
    lineId: line.id,
    itemId: line.itemId,
    name: line.item.name,
    qty: line.qty,
    pricePaise: line.pricePaise,
    priceDisplay: `Rs ${paiseToRupeesString(line.pricePaise)}`,
    lineTotalPaise: lineTaxablePaise(line)
  }));
  // This total is the taxable base before GST; tax is calculated during invoicing.
  const taxableTotalPaise = orderTaxablePaise(order.lines);
  return {
    id: order.id,
    orderNo: order.orderNo,
    clientRef: order.clientRef,
    status: order.status,
    customer: order.customer,
    notes: order.notes,
    createdAt: order.createdAt,
    lines,
    taxableTotalPaise,
    totalDisplay: paiseToRupeesString(taxableTotalPaise)
  };
}

function resultFor(order, userId) {
  if (order.salesmanId !== userId) {
    throw new AppError(
      409,
      'CLIENT_REF_TAKEN',
      'This clientRef is already used by another salesman'
    );
  }
  return { duplicate: true, order: presentOrder(order) };
}

function isClientRefUniqueViolation(error) {
  if (error?.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes('clientRef')
    : typeof target === 'string' && target.toLowerCase().includes('clientref');
}

async function findClientRefOrder(db, clientRef) {
  return db.order.findUnique({
    where: { clientRef },
    include: orderInclude
  });
}

function orderableError(itemId) {
  return new AppError(
    422,
    'ITEM_NOT_ORDERABLE',
    'Order items must be active finished goods',
    { itemId }
  );
}

export async function createOrder(user, input) {
  assertUser(user);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Order input must be an object');
  }

  const create = async (tx) => {
    if (input.clientRef !== undefined) {
      const existing = await findClientRefOrder(tx, input.clientRef);
      if (existing) {
        return resultFor(existing, user.id);
      }
    }

    const customer = await getCustomer(tx, input.customerId, user);
    if (!customer.isActive) {
      throw new AppError(
        422,
        'CUSTOMER_INACTIVE',
        'Customer is inactive',
        { customerId: customer.id }
      );
    }

    const lines = mergeLines(input.lines);
    const itemIds = lines.map(({ itemId }) => itemId);
    const items = await tx.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, type: true, isActive: true }
    });
    const itemById = new Map(items.map((item) => [item.id, item]));
    for (const { itemId } of lines) {
      const item = itemById.get(itemId);
      if (!item || !item.isActive || item.type !== 'FINISHED') {
        throw orderableError(itemId);
      }
    }

    const prices = await resolvePrices(tx, customer.id, itemIds);
    const pricedLines = lines.map((line) => {
      const price = prices.get(line.itemId);
      if (!price) {
        throw new AppError(
          422,
          'NO_PRICE',
          'No customer or default price is set for this item',
          { customerId: customer.id, itemId: line.itemId }
        );
      }
      return { ...line, pricePaise: price.pricePaise };
    });
    try {
      orderTaxablePaise(pricedLines);
    } catch (error) {
      if (error instanceof RangeError) {
        throw badRequest('Order taxable total exceeds the supported range');
      }
      throw error;
    }

    const orderNo = await nextNumber(tx, 'ORD');
    const order = await tx.order.create({
      data: {
        orderNo,
        clientRef: input.clientRef ?? null,
        customerId: customer.id,
        salesmanId: user.id,
        status: 'SUBMITTED',
        notes: input.notes,
        lines: {
          create: pricedLines.map((line) => ({
            itemId: line.itemId,
            qty: line.qty,
            pricePaise: line.pricePaise,
            approvedQty: null,
            approvedPricePaise: null
          }))
        }
      },
      include: orderInclude
    });
    const summary = presentOrder(order);
    await writeAudit(tx, {
      userId: user.id,
      action: 'CREATE',
      entity: 'Order',
      entityId: order.id,
      after: summary
    });
    return { duplicate: false, order: summary };
  };

  try {
    return await prisma.$transaction(create, { maxWait: 60000, timeout: 60000 });
  } catch (error) {
    if (!input.clientRef || !isClientRefUniqueViolation(error)) {
      throw error;
    }
    const existing = await findClientRefOrder(prisma, input.clientRef);
    if (!existing) {
      throw error;
    }
    return resultFor(existing, user.id);
  }
}
