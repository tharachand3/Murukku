import { AppError, badRequest, notFound } from '../lib/errors.js';
import { financialYearOf } from '../lib/fy.js';
import { istDayRange } from '../lib/istDate.js';
import { formatQty } from '../lib/units.js';
import { paiseToRupeesString } from '../lib/money.js';
import { writeAudit } from '../lib/audit.js';
import { canTransition } from '../lib/orderStatus.js';
import { buildOrderInvoiceDraft } from './gstService.js';
import { prisma } from '../lib/prisma.js';
import { nextNumber } from './numberingService.js';

const POSTGRES_INT_MAX = 2147483647;

function assertId(id, name) {
  if (!Number.isSafeInteger(id) || id <= 0 || id > POSTGRES_INT_MAX) {
    throw badRequest(`${name} must be a positive integer`);
  }
}

function invalidOrderStatus(status, to) {
  return new AppError(
    409,
    'INVALID_STATUS',
    `Cannot transition order from ${status} to ${to}`,
    { from: status, to }
  );
}

function isOrderIdUniqueViolation(error) {
  if (error?.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes('orderId')
    : typeof target === 'string' && /orderId|order_id/i.test(target);
}

function moneyDisplay(value) {
  return `Rs ${paiseToRupeesString(value)}`;
}

function presentInvoiceLine(line, dispatchedQty) {
  const { item, ...snapshot } = line;
  const baseUnit = item.baseUnit.code;
  return {
    ...snapshot,
    qtyDisplay: formatQty(line.qty, baseUnit),
    dispatchedQty,
    dispatchedQtyDisplay: formatQty(dispatchedQty, baseUnit),
    rateDisplay: moneyDisplay(line.ratePaise),
    taxableValueDisplay: moneyDisplay(line.taxableValuePaise),
    cgstDisplay: moneyDisplay(line.cgstPaise),
    sgstDisplay: moneyDisplay(line.sgstPaise),
    igstDisplay: moneyDisplay(line.igstPaise),
    totalDisplay: moneyDisplay(line.totalPaise)
  };
}

function presentInvoice(invoice) {
  const dispatchedByItem = new Map();
  for (const dispatch of invoice.dispatches) {
    for (const line of dispatch.lines) {
      dispatchedByItem.set(
        line.itemId,
        (dispatchedByItem.get(line.itemId) ?? 0) + line.qty
      );
    }
  }

  return {
    id: invoice.id,
    invoiceNo: invoice.invoiceNo,
    financialYear: invoice.financialYear,
    orderId: invoice.orderId,
    order: invoice.order,
    customerId: invoice.customerId,
    customer: invoice.snapshot?.buyer ?? invoice.customer,
    issueDate: invoice.issueDate,
    placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
    isInterState: invoice.isInterState,
    taxableValuePaise: invoice.taxableValuePaise,
    cgstPaise: invoice.cgstPaise,
    sgstPaise: invoice.sgstPaise,
    igstPaise: invoice.igstPaise,
    totalPaise: invoice.totalPaise,
    totalDisplay: moneyDisplay(invoice.totalPaise),
    status: invoice.status,
    cancelledAt: invoice.cancelledAt,
    cancelReason: invoice.cancelReason,
    createdById: invoice.createdById,
    createdAt: invoice.createdAt,
    snapshot: invoice.snapshot,
    lines: invoice.lines.map((line) => presentInvoiceLine(
      line,
      dispatchedByItem.get(line.itemId) ?? 0
    ))
  };
}

const invoiceDetailInclude = {
  customer: {
    select: {
      id: true,
      name: true,
      gstin: true,
      stateCode: true,
      stateName: true,
      address: true
    }
  },
  order: { select: { id: true, orderNo: true } },
  lines: {
    orderBy: { id: 'asc' },
    include: {
      item: { select: { id: true, name: true, baseUnit: { select: { code: true } } } }
    }
  },
  dispatches: {
    select: {
      lines: { select: { itemId: true, qty: true } }
    }
  }
};

export async function createInvoice(user, input) {
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw badRequest('A valid user is required');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Invoice input must be an object');
  }
  assertId(input.orderId, 'orderId');

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: { invoice: { select: { id: true } } }
      });
      if (!order) {
        throw notFound('Order not found');
      }
      if (order.invoice) {
        throw new AppError(409, 'ALREADY_INVOICED', 'Order already has an invoice');
      }
      if (!canTransition(order.status, 'INVOICED')) {
        throw invalidOrderStatus(order.status, 'INVOICED');
      }

      const draft = await buildOrderInvoiceDraft(tx, order.id);
      const issueDate = new Date();
      const invoiceNo = await nextNumber(tx, 'INV', issueDate);
      const invoice = await tx.invoice.create({
        data: {
          invoiceNo,
          financialYear: financialYearOf(issueDate),
          orderId: order.id,
          customerId: draft.customer.id,
          issueDate,
          placeOfSupplyStateCode: draft.placeOfSupplyStateCode,
          isInterState: draft.isInterState,
          taxableValuePaise: draft.totals.taxableValuePaise,
          cgstPaise: draft.totals.cgstPaise,
          sgstPaise: draft.totals.sgstPaise,
          igstPaise: draft.totals.igstPaise,
          totalPaise: draft.totals.totalPaise,
          createdById: user.id,
          snapshot: {
            seller: draft.seller,
            buyer: draft.customer,
            orderNo: draft.orderNo
          },
          lines: {
            create: draft.lines.map((line) => ({
              itemId: line.itemId,
              description: line.description,
              hsnCode: line.hsnCode,
              qty: line.qty,
              ratePaise: line.ratePaise,
              taxableValuePaise: line.taxableValuePaise,
              gstRateBp: line.gstRateBp,
              cgstPaise: line.cgstPaise,
              sgstPaise: line.sgstPaise,
              igstPaise: line.igstPaise,
              totalPaise: line.totalPaise
            }))
          }
        },
        select: { id: true, invoiceNo: true, totalPaise: true, status: true }
      });

      await tx.order.update({
        where: { id: order.id },
        data: { status: 'INVOICED' }
      });

      await writeAudit(tx, {
        userId: user.id,
        action: 'CREATE',
        entity: 'Invoice',
        entityId: invoice.id,
        after: {
          invoiceNo: invoice.invoiceNo,
          orderId: order.id,
          customerId: draft.customer.id,
          totalPaise: invoice.totalPaise,
          status: invoice.status
        }
      });
      await writeAudit(tx, {
        userId: user.id,
        action: 'INVOICE',
        entity: 'Order',
        entityId: order.id,
        before: { orderNo: order.orderNo, status: order.status },
        after: {
          orderNo: order.orderNo,
          status: 'INVOICED',
          invoiceNo: invoice.invoiceNo,
          note: invoice.invoiceNo
        }
      });

      return getInvoiceDetails(tx, invoice.id);
    }, { maxWait: 60000, timeout: 60000 });
  } catch (error) {
    if (isOrderIdUniqueViolation(error)) {
      throw new AppError(409, 'ALREADY_INVOICED', 'Order already has an invoice');
    }
    throw error;
  }
}

export async function listInvoices(db, input) {
  const { gte, lt } = istDayRange(input.from, input.to);
  const issueDate = {};
  if (gte) issueDate.gte = gte;
  if (lt) issueDate.lt = lt;
  const where = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    ...(Object.keys(issueDate).length ? { issueDate } : {}),
    ...(input.q ? { invoiceNo: { contains: input.q, mode: 'insensitive' } } : {})
  };

  const [invoices, total] = await Promise.all([
    db.invoice.findMany({
      where,
      orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      include: {
        customer: { select: { id: true, name: true } },
        order: { select: { id: true, orderNo: true } }
      }
    }),
    db.invoice.count({ where })
  ]);
  return {
    items: invoices.map((invoice) => ({
      ...invoice,
      totalDisplay: moneyDisplay(invoice.totalPaise)
    })),
    page: input.page,
    limit: input.limit,
    total
  };
}

export async function getInvoiceDetails(db, invoiceId) {
  assertId(invoiceId, 'id');
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: invoiceDetailInclude
  });
  if (!invoice) {
    throw notFound('Invoice not found');
  }
  return presentInvoice(invoice);
}
