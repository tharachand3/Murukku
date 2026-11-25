import { z } from 'zod';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { istDayRange } from '../lib/istDate.js';
import { paiseToRupeesString } from '../lib/money.js';
import { formatQty } from '../lib/units.js';
import { writeAudit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';
import { addMovement } from './ledgerService.js';
import { nextNumber } from './numberingService.js';
import { getCustomerOutstanding } from './paymentService.js';

const POSTGRES_INT_MAX = 2147483647;

function assertId(id, name) {
  if (!Number.isSafeInteger(id) || id <= 0 || id > POSTGRES_INT_MAX) {
    throw badRequest(`${name} must be a positive integer`);
  }
}

function moneyDisplay(value) {
  return `Rs ${paiseToRupeesString(value)}`;
}

function safeQty(value) {
  const qty = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > POSTGRES_INT_MAX) {
    throw new RangeError('Dispatched quantity exceeds the supported range');
  }
  return qty;
}

export const cancelInvoiceSchema = z.object({
  reason: z.string().trim().min(5).max(300)
}).strict();

export async function cancelInvoice(user, invoiceId, input) {
  assertId(user?.id, 'userId');
  assertId(invoiceId, 'invoiceId');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Cancellation input must be an object');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE
    `;
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNo: true,
        status: true,
        orderId: true,
        customerId: true,
        taxableValuePaise: true,
        cgstPaise: true,
        sgstPaise: true,
        igstPaise: true,
        totalPaise: true,
        order: { select: { id: true, orderNo: true, status: true } }
      }
    });
    if (!invoice) {
      throw notFound('Invoice not found');
    }
    if (invoice.status !== 'POSTED') {
      throw new AppError(
        409,
        'INVOICE_ALREADY_CANCELLED',
        'Invoice is already cancelled'
      );
    }

    const noteNo = await nextNumber(tx, 'CN');
    const creditNote = await tx.creditNote.create({
      data: {
        noteNo,
        invoiceId: invoice.id,
        reason: input.reason,
        taxableValuePaise: invoice.taxableValuePaise,
        cgstPaise: invoice.cgstPaise,
        sgstPaise: invoice.sgstPaise,
        igstPaise: invoice.igstPaise,
        totalPaise: invoice.totalPaise,
        createdById: user.id
      }
    });

    const dispatchedLines = await tx.$queryRaw`
      SELECT dl."itemId", i.name, u.code AS "displayUnit",
        SUM(dl.qty)::bigint AS qty
      FROM "DispatchLine" dl
      JOIN "Dispatch" d ON d.id = dl."dispatchId"
      JOIN "Item" i ON i.id = dl."itemId"
      JOIN "Unit" u ON u.id = i."displayUnitId"
      WHERE d."invoiceId" = ${invoice.id}
      GROUP BY dl."itemId", i.name, u.code
      ORDER BY dl."itemId"
    `;
    const stockReversed = [];
    for (const line of dispatchedLines) {
      const qty = safeQty(line.qty);
      await addMovement(tx, {
        itemId: line.itemId,
        qtyChange: qty,
        movementType: 'SALES_RETURN',
        sourceType: 'CREDIT_NOTE',
        sourceId: creditNote.id,
        sourceRef: noteNo,
        userId: user.id,
        note: `Reversal: invoice ${invoice.invoiceNo} cancelled`
      });
      stockReversed.push({
        itemId: line.itemId,
        name: line.name,
        qty,
        display: formatQty(qty, line.displayUnit)
      });
    }

    const cancelledAt = new Date();
    const updatedInvoice = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'CANCELLED',
        cancelledAt,
        cancelReason: input.reason
      },
      select: {
        id: true,
        invoiceNo: true,
        status: true,
        cancelledAt: true,
        cancelReason: true
      }
    });

    let updatedOrder = null;
    if (invoice.order) {
      updatedOrder = await tx.order.update({
        where: { id: invoice.order.id },
        data: { status: 'CANCELLED' },
        select: { id: true, orderNo: true, status: true }
      });
    }

    await writeAudit(tx, {
      userId: user.id,
      action: 'CANCEL',
      entity: 'Invoice',
      entityId: invoice.id,
      before: { status: invoice.status },
      after: {
        status: updatedInvoice.status,
        cancelledAt: updatedInvoice.cancelledAt,
        cancelReason: updatedInvoice.cancelReason,
        creditNoteNo: creditNote.noteNo
      }
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'CREATE',
      entity: 'CreditNote',
      entityId: creditNote.id,
      after: creditNote
    });
    if (invoice.order && updatedOrder) {
      await writeAudit(tx, {
        userId: user.id,
        action: 'UPDATE',
        entity: 'Order',
        entityId: updatedOrder.id,
        before: { orderNo: invoice.order.orderNo, status: invoice.order.status },
        after: { orderNo: updatedOrder.orderNo, status: updatedOrder.status }
      });
    }

    const customerOutstanding = await getCustomerOutstanding(tx, invoice.customerId);
    return {
      invoice: updatedInvoice,
      creditNote: {
        id: creditNote.id,
        noteNo: creditNote.noteNo,
        invoiceId: creditNote.invoiceId,
        reason: creditNote.reason,
        taxableValuePaise: creditNote.taxableValuePaise,
        cgstPaise: creditNote.cgstPaise,
        sgstPaise: creditNote.sgstPaise,
        igstPaise: creditNote.igstPaise,
        totalPaise: creditNote.totalPaise,
        totalDisplay: moneyDisplay(creditNote.totalPaise),
        createdAt: creditNote.createdAt
      },
      stockReversed,
      customerBalance: {
        outstandingPaise: customerOutstanding.outstandingPaise,
        creditPaise: customerOutstanding.creditPaise
      }
    };
  }, { maxWait: 60000, timeout: 60000 });
}

export async function getCreditNote(db, creditNoteId) {
  assertId(creditNoteId, 'id');
  const creditNote = await db.creditNote.findUnique({
    where: { id: creditNoteId },
    include: {
      invoice: {
        select: {
          id: true,
          invoiceNo: true,
          customer: { select: { id: true, name: true, type: true } }
        }
      },
      createdBy: { select: { id: true, name: true } }
    }
  });
  if (!creditNote) {
    throw notFound('Credit note not found');
  }
  return { ...creditNote, totalDisplay: moneyDisplay(creditNote.totalPaise) };
}

export async function getCreditNoteForInvoice(db, invoiceId) {
  assertId(invoiceId, 'invoiceId');
  const creditNote = await db.creditNote.findFirst({
    where: { invoiceId },
    orderBy: { id: 'asc' },
    select: { id: true, noteNo: true, totalPaise: true, createdAt: true }
  });
  return creditNote;
}

export async function listCreditNotes(db, input) {
  const { gte, lt } = istDayRange(input.from, input.to);
  const createdAt = {};
  if (gte) createdAt.gte = gte;
  if (lt) createdAt.lt = lt;
  const where = {
    ...(input.customerId !== undefined
      ? { invoice: { customerId: input.customerId } }
      : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {})
  };
  const [creditNotes, total] = await Promise.all([
    db.creditNote.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNo: true,
            customer: { select: { id: true, name: true, type: true } }
          }
        }
      }
    }),
    db.creditNote.count({ where })
  ]);
  return {
    items: creditNotes.map((creditNote) => ({
      ...creditNote,
      totalDisplay: moneyDisplay(creditNote.totalPaise)
    })),
    page: input.page,
    limit: input.limit,
    total
  };
}
