import { Prisma } from '@prisma/client';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { formatQty } from '../lib/units.js';
import { istDayRange } from '../lib/istDate.js';
import { writeAudit } from '../lib/audit.js';
import { canTransition } from '../lib/orderStatus.js';
import { addMovement, getBalance } from './ledgerService.js';
import { getReservedPackets } from './availabilityService.js';
import { nextNumber } from './numberingService.js';
import { prisma } from '../lib/prisma.js';

const POSTGRES_INT_MAX = 2147483647;

function assertId(id, name) {
  if (!Number.isSafeInteger(id) || id <= 0 || id > POSTGRES_INT_MAX) {
    throw badRequest(`${name} must be a positive integer`);
  }
}

function addSafeIntegers(left, right, name) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result > POSTGRES_INT_MAX) {
    throw badRequest(`${name} exceeds the supported range`);
  }
  return result;
}

function invoiceNotFound() {
  return notFound('Invoice not found');
}

function addDispatchLine(totals, line, name, displayUnit) {
  const current = totals.get(line.itemId);
  if (current) {
    current.qty = addSafeIntegers(current.qty, line.qty, 'Dispatch quantity');
  } else {
    totals.set(line.itemId, {
      itemId: line.itemId,
      name,
      displayUnit,
      qty: line.qty
    });
  }
}

export async function getInvoiceDispatchStatus(db, invoiceId) {
  assertId(invoiceId, 'invoiceId');
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lines: {
        orderBy: { id: 'asc' },
        include: {
          item: {
            select: {
              displayUnit: { select: { code: true } }
            }
          }
        }
      },
      dispatches: {
        select: {
          lines: { select: { itemId: true, qty: true } }
        }
      }
    }
  });
  if (!invoice) {
    throw invoiceNotFound();
  }

  const invoicedByItem = new Map();
  for (const line of invoice.lines) {
    addDispatchLine(
      invoicedByItem,
      { itemId: line.itemId, qty: line.qty },
      line.description,
      line.item.displayUnit.code
    );
  }

  const dispatchedByItem = new Map();
  for (const dispatch of invoice.dispatches) {
    for (const line of dispatch.lines) {
      dispatchedByItem.set(
        line.itemId,
        addSafeIntegers(
          dispatchedByItem.get(line.itemId) ?? 0,
          line.qty,
          'Dispatched quantity'
        )
      );
    }
  }

  const lines = [...invoicedByItem.values()].map((line) => {
    const dispatchedQty = dispatchedByItem.get(line.itemId) ?? 0;
    const remainingQty = Math.max(0, line.qty - dispatchedQty);
    return {
      itemId: line.itemId,
      name: line.name,
      invoicedQty: line.qty,
      dispatchedQty,
      remainingQty,
      display: formatQty(remainingQty, line.displayUnit)
    };
  });

  return {
    invoiceId: invoice.id,
    invoiceNo: invoice.invoiceNo,
    fullyDispatched: lines.every((line) => line.remainingQty === 0),
    lines
  };
}

function mergeRequestedLines(lines, invoiceLines) {
  const invoiceLineByItem = new Map(invoiceLines.map((line) => [line.itemId, line]));
  const merged = new Map();
  for (const line of lines) {
    if (!invoiceLineByItem.has(line.itemId)) {
      throw new AppError(
        422,
        'ITEM_NOT_ON_INVOICE',
        'Item is not on this invoice',
        { itemId: line.itemId }
      );
    }
    const current = merged.get(line.itemId);
    if (current) {
      current.qty = addSafeIntegers(current.qty, line.qty, 'Dispatch quantity');
    } else {
      merged.set(line.itemId, { itemId: line.itemId, qty: line.qty });
    }
  }

  return [...merged.values()].map((line) => {
    const invoiceLine = invoiceLineByItem.get(line.itemId);
    const remaining = invoiceLine.remainingQty;
    if (line.qty > remaining) {
      throw new AppError(
        422,
        'DISPATCH_EXCEEDS_INVOICE',
        `Requested dispatch quantity exceeds the remaining invoiced quantity for "${invoiceLine.name}"`,
        {
          itemId: line.itemId,
          name: invoiceLine.name,
          remaining,
          requested: line.qty
        }
      );
    }
    return { ...line, name: invoiceLine.name };
  });
}

async function lockDispatchItems(tx, itemIds) {
  const orderedIds = [...new Set(itemIds)].sort((left, right) => left - right);
  if (orderedIds.length === 0) {
    return;
  }
  await tx.$queryRaw`
    SELECT id FROM "Item"
    WHERE id IN (${Prisma.join(orderedIds)})
    ORDER BY id
    FOR UPDATE
  `;
}

async function getDispatchLines(tx, dispatchId) {
  const lines = await tx.dispatchLine.findMany({
    where: { dispatchId },
    orderBy: { id: 'asc' },
    include: {
      item: { select: { name: true, displayUnit: { select: { code: true } } } }
    }
  });
  return lines.map((line) => ({
    itemId: line.itemId,
    name: line.item.name,
    qty: line.qty,
    display: formatQty(line.qty, line.item.displayUnit.code)
  }));
}

export async function createDispatch(user, input) {
  assertId(user?.id, 'userId');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Dispatch input must be an object');
  }
  assertId(input.invoiceId, 'invoiceId');
  if (
    input.lines !== undefined &&
    (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 50)
  ) {
    throw badRequest('lines must contain between 1 and 50 items');
  }
  for (const line of input.lines ?? []) {
    assertId(line?.itemId, 'itemId');
    if (!Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > POSTGRES_INT_MAX) {
      throw badRequest('qty must be a positive PostgreSQL integer');
    }
  }

  const dispatchDate = input.dispatchDate ?? new Date();
  if (!(dispatchDate instanceof Date) || Number.isNaN(dispatchDate.getTime())) {
    throw badRequest('dispatchDate must be a valid ISO datetime');
  }
  if (dispatchDate > new Date()) {
    throw badRequest('dispatchDate cannot be in the future');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE
    `;
    const invoice = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      select: {
        id: true,
        invoiceNo: true,
        status: true,
        orderId: true,
        customerId: true,
        snapshot: true,
        customer: { select: { id: true, name: true } }
      }
    });
    if (!invoice) {
      throw invoiceNotFound();
    }
    if (invoice.status !== 'POSTED') {
      throw new AppError(
        409,
        'INVOICE_CANCELLED',
        'Cancelled invoices cannot be dispatched'
      );
    }

    const invoiceStatus = await getInvoiceDispatchStatus(tx, invoice.id);
    if (invoiceStatus.fullyDispatched) {
      throw new AppError(
        409,
        'ALREADY_DISPATCHED',
        'All invoice quantities have already been dispatched'
      );
    }
    const availableInvoiceLines = invoiceStatus.lines.filter(
      (line) => line.remainingQty > 0
    );
    const requestedLines = input.lines === undefined
      ? availableInvoiceLines.map(({ itemId, name, remainingQty }) => ({
          itemId,
          qty: remainingQty,
          name
        }))
      : mergeRequestedLines(input.lines, invoiceStatus.lines);

    const remainingByItem = new Map(
      availableInvoiceLines.map((line) => [line.itemId, line])
    );
    for (const line of requestedLines) {
      const invoiceLine = remainingByItem.get(line.itemId);
      if (!invoiceLine) {
        throw new AppError(
          422,
          'DISPATCH_EXCEEDS_INVOICE',
          'This invoice item has no remaining quantity',
          {
            itemId: line.itemId,
            name: line.name,
            remaining: 0,
            requested: line.qty
          }
        );
      }
      if (line.qty > invoiceLine.remainingQty) {
        throw new AppError(
          422,
          'DISPATCH_EXCEEDS_INVOICE',
          `Requested dispatch quantity exceeds the remaining invoiced quantity for "${invoiceLine.name}"`,
          {
            itemId: line.itemId,
            name: invoiceLine.name,
            remaining: invoiceLine.remainingQty,
            requested: line.qty
          }
        );
      }
    }

    await lockDispatchItems(tx, requestedLines.map((line) => line.itemId));
    const linesWithStock = [];
    for (const line of requestedLines) {
      const [onHand, reservedByOthers] = await Promise.all([
        getBalance(tx, line.itemId),
        getReservedPackets(tx, line.itemId, {
          ...(invoice.orderId !== null ? { excludeOrderId: invoice.orderId } : {})
        })
      ]);
      const available = Math.max(0, onHand - reservedByOthers);
      if (line.qty > available) {
        throw new AppError(
          422,
          'INSUFFICIENT_STOCK',
          `Insufficient free stock for "${line.name}"`,
          {
            itemId: line.itemId,
            itemName: line.name,
            onHand,
            reservedByOthers,
            available,
            requested: line.qty,
            shortBy: line.qty - available
          }
        );
      }
      linesWithStock.push(line);
    }

    const dispatchNo = await nextNumber(tx, 'DSP');
    const dispatch = await tx.dispatch.create({
      data: {
        dispatchNo,
        invoiceId: invoice.id,
        dispatchDate,
        vehicleNo: input.vehicleNo,
        notes: input.notes,
        createdById: user.id,
        lines: {
          create: linesWithStock.map(({ itemId, qty }) => ({ itemId, qty }))
        }
      },
      select: {
        id: true,
        dispatchNo: true,
        dispatchDate: true,
        vehicleNo: true,
        notes: true
      }
    });

    for (const line of linesWithStock) {
      await addMovement(tx, {
        itemId: line.itemId,
        qtyChange: -line.qty,
        movementType: 'DISPATCH',
        sourceType: 'DISPATCH',
        sourceId: dispatch.id,
        sourceRef: dispatch.dispatchNo,
        movementDate: dispatchDate,
        userId: user.id,
        note: `Invoice ${invoice.invoiceNo}`
      });
    }

    const afterStatus = await getInvoiceDispatchStatus(tx, invoice.id);
    let orderStatus = null;
    let orderBefore = null;
    if (invoice.orderId !== null) {
      await tx.$queryRaw`
        SELECT id FROM "Order" WHERE id = ${invoice.orderId} FOR UPDATE
      `;
      const order = await tx.order.findUnique({
        where: { id: invoice.orderId },
        select: { id: true, orderNo: true, status: true }
      });
      if (order) {
        orderStatus = order.status;
        if (
          afterStatus.fullyDispatched &&
          order.status === 'INVOICED' &&
          canTransition(order.status, 'DISPATCHED')
        ) {
          orderBefore = order;
          const updatedOrder = await tx.order.update({
            where: { id: order.id },
            data: { status: 'DISPATCHED' },
            select: { id: true, orderNo: true, status: true }
          });
          orderStatus = updatedOrder.status;
        }
      }
    }

    const lines = await getDispatchLines(tx, dispatch.id);
    await writeAudit(tx, {
      userId: user.id,
      action: 'CREATE',
      entity: 'Dispatch',
      entityId: dispatch.id,
      after: {
        ...dispatch,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        customerId: invoice.customerId,
        lines,
        orderStatus
      }
    });
    if (orderBefore) {
      await writeAudit(tx, {
        userId: user.id,
        action: 'UPDATE',
        entity: 'Order',
        entityId: orderBefore.id,
        before: { orderNo: orderBefore.orderNo, status: orderBefore.status },
        after: { orderNo: orderBefore.orderNo, status: orderStatus }
      });
    }

    const buyer = invoice.snapshot?.buyer ?? invoice.customer;
    return {
      dispatch: {
        ...dispatch,
        invoice: { id: invoice.id, invoiceNo: invoice.invoiceNo },
        customer: { id: buyer.id, name: buyer.name },
        lines,
        orderStatus
      },
      invoiceFullyDispatched: afterStatus.fullyDispatched
    };
  }, { maxWait: 60000, timeout: 60000 });
}

export async function listDispatches(db, input) {
  const { gte, lt } = istDayRange(input.from, input.to);
  const dispatchDate = {};
  if (gte) dispatchDate.gte = gte;
  if (lt) dispatchDate.lt = lt;
  const where = {
    ...(input.invoiceId !== undefined ? { invoiceId: input.invoiceId } : {}),
    ...(input.customerId !== undefined
      ? { invoice: { customerId: input.customerId } }
      : {}),
    ...(Object.keys(dispatchDate).length ? { dispatchDate } : {})
  };
  const [dispatches, total] = await Promise.all([
    db.dispatch.findMany({
      where,
      orderBy: [{ dispatchDate: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNo: true,
            snapshot: true,
            customer: { select: { id: true, name: true } }
          }
        },
        lines: { select: { itemId: true, qty: true } }
      }
    }),
    db.dispatch.count({ where })
  ]);
  return {
    items: dispatches.map((dispatch) => ({
      id: dispatch.id,
      dispatchNo: dispatch.dispatchNo,
      dispatchDate: dispatch.dispatchDate,
      vehicleNo: dispatch.vehicleNo,
      notes: dispatch.notes,
      invoice: { id: dispatch.invoice.id, invoiceNo: dispatch.invoice.invoiceNo },
      customer: dispatch.invoice.snapshot?.buyer ?? dispatch.invoice.customer,
      lineCount: dispatch.lines.length
    })),
    page: input.page,
    limit: input.limit,
    total
  };
}

export async function getDispatchDetails(db, dispatchId) {
  assertId(dispatchId, 'id');
  const dispatch = await db.dispatch.findUnique({
    where: { id: dispatchId },
    include: {
      invoice: {
        select: {
          id: true,
          invoiceNo: true,
          status: true,
          totalPaise: true,
          order: { select: { id: true, orderNo: true, status: true } },
          snapshot: true,
          customer: { select: { id: true, name: true } }
        }
      },
      lines: {
        orderBy: { id: 'asc' },
        include: {
          item: {
            select: { name: true, displayUnit: { select: { code: true } } }
          }
        }
      }
    }
  });
  if (!dispatch) {
    throw notFound('Dispatch not found');
  }

  const movements = await db.stockMovement.findMany({
    where: { sourceType: 'DISPATCH', sourceId: dispatch.id },
    orderBy: [{ movementDate: 'asc' }, { id: 'asc' }],
    include: {
      item: { select: { name: true, displayUnit: { select: { code: true } } } },
      createdBy: { select: { id: true, name: true } }
    }
  });
  const buyer = dispatch.invoice.snapshot?.buyer ?? dispatch.invoice.customer;
  return {
    id: dispatch.id,
    dispatchNo: dispatch.dispatchNo,
    dispatchDate: dispatch.dispatchDate,
    vehicleNo: dispatch.vehicleNo,
    notes: dispatch.notes,
    createdById: dispatch.createdById,
    invoice: {
      id: dispatch.invoice.id,
      invoiceNo: dispatch.invoice.invoiceNo,
      status: dispatch.invoice.status,
      totalPaise: dispatch.invoice.totalPaise,
      order: dispatch.invoice.order
    },
    customer: buyer,
    lines: dispatch.lines.map((line) => ({
      itemId: line.itemId,
      name: line.item.name,
      qty: line.qty,
      display: formatQty(line.qty, line.item.displayUnit.code)
    })),
    ledgerRows: movements.map((movement) => ({
      id: movement.id,
      itemId: movement.itemId,
      itemName: movement.item.name,
      movementType: movement.movementType,
      qtyChange: movement.qtyChange,
      qtyDisplay: formatQty(Math.abs(movement.qtyChange), movement.item.displayUnit.code),
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      sourceRef: movement.sourceRef,
      movementDate: movement.movementDate,
      ratePaisePerBase: movement.ratePaisePerBase?.toString() ?? null,
      valuePaise: movement.valuePaise,
      note: movement.note,
      createdBy: movement.createdBy
    }))
  };
}
