import { z } from 'zod';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { istDayRange } from '../lib/istDate.js';
import { paiseToRupeesString } from '../lib/money.js';
import { customerBalance, invoiceStatus } from '../lib/outstanding.js';
import { writeAudit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';
import { nextNumber } from './numberingService.js';

const POSTGRES_INT_MAX = 2147483647;

function assertId(id, name) {
  if (!Number.isSafeInteger(id) || id <= 0 || id > POSTGRES_INT_MAX) {
    throw badRequest(`${name} must be a positive integer`);
  }
}

function moneyDisplay(value) {
  return `Rs ${paiseToRupeesString(value)}`;
}

function safeSum(value, name) {
  const number = typeof value === 'bigint' ? Number(value) : (value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return number;
}

function overpayment(dueSoFarPaise) {
  return new AppError(
    422,
    'OVERPAYMENT',
    'Payment exceeds the outstanding amount',
    { dueSoFarPaise }
  );
}

export const paymentInputSchema = z.object({
  customerId: z.number().int().positive().max(POSTGRES_INT_MAX),
  invoiceId: z.number().int().positive().max(POSTGRES_INT_MAX).optional(),
  amountPaise: z.number().int().min(1).max(1000000000),
  mode: z.enum(['CASH', 'UPI', 'BANK', 'CHEQUE']),
  reference: z.string().trim().min(1).max(60).optional(),
  paymentDate: z.string().datetime({ offset: true })
    .transform((value) => new Date(value))
    .refine((value) => value <= new Date(), 'paymentDate cannot be in the future')
    .optional(),
  notes: z.string().trim().max(300).optional()
}).strict().superRefine((payment, context) => {
  if (payment.mode !== 'CASH' && (!payment.reference || payment.reference.length < 3)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'reference is required and must be at least 3 characters for this payment mode',
      path: ['reference']
    });
  }
});

export async function recordPayment(user, input) {
  assertId(user?.id, 'userId');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Payment input must be an object');
  }
  assertId(input.customerId, 'customerId');
  if (input.invoiceId !== undefined) {
    assertId(input.invoiceId, 'invoiceId');
  }

  const paymentDate = input.paymentDate ?? new Date();
  if (!(paymentDate instanceof Date) || Number.isNaN(paymentDate.getTime())) {
    throw badRequest('paymentDate must be a valid ISO datetime');
  }
  if (paymentDate > new Date()) {
    throw badRequest('paymentDate cannot be in the future');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "Customer" WHERE id = ${input.customerId} FOR UPDATE
    `;
    const customer = await tx.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, name: true, type: true }
    });
    if (!customer) {
      throw notFound('Customer not found');
    }

    let invoice = null;
    let dueSoFarPaise;
    if (input.invoiceId !== undefined) {
      await tx.$queryRaw`
        SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE
      `;
      invoice = await tx.invoice.findUnique({
        where: { id: input.invoiceId },
        select: {
          id: true,
          invoiceNo: true,
          customerId: true,
          status: true,
          totalPaise: true
        }
      });
      if (!invoice) {
        throw notFound('Invoice not found');
      }
      if (invoice.customerId !== customer.id) {
        throw new AppError(
          422,
          'INVOICE_CUSTOMER_MISMATCH',
          'Invoice does not belong to this customer'
        );
      }
      if (invoice.status !== 'POSTED') {
        throw new AppError(
          409,
          'INVOICE_CANCELLED',
          'Payments cannot be applied to a cancelled invoice'
        );
      }
      const linkedPayments = await tx.payment.aggregate({
        where: { invoiceId: invoice.id },
        _sum: { amountPaise: true }
      });
      dueSoFarPaise = Math.max(
        0,
        invoice.totalPaise - safeSum(linkedPayments._sum.amountPaise, 'Invoice payments')
      );
    } else {
      const [invoices, payments] = await Promise.all([
        tx.invoice.aggregate({
          where: { customerId: customer.id, status: 'POSTED' },
          _sum: { totalPaise: true }
        }),
        tx.payment.aggregate({
          where: { customerId: customer.id },
          _sum: { amountPaise: true }
        })
      ]);
      const balance = customerBalance({
        postedInvoicesPaise: safeSum(invoices._sum.totalPaise, 'Posted invoice total'),
        paymentsPaise: safeSum(payments._sum.amountPaise, 'Customer payments')
      });
      dueSoFarPaise = balance.outstandingPaise;
    }

    if (input.amountPaise > dueSoFarPaise) {
      throw overpayment(dueSoFarPaise);
    }

    const receiptNo = await nextNumber(tx, 'RCT');
    const payment = await tx.payment.create({
      data: {
        receiptNo,
        customerId: customer.id,
        invoiceId: invoice?.id ?? null,
        amountPaise: input.amountPaise,
        mode: input.mode,
        reference: input.reference,
        paymentDate,
        notes: input.notes,
        createdById: user.id
      },
      select: {
        id: true,
        receiptNo: true,
        customerId: true,
        invoiceId: true,
        amountPaise: true,
        mode: true,
        reference: true,
        paymentDate: true,
        notes: true,
        createdById: true,
        createdAt: true
      }
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'CREATE',
      entity: 'Payment',
      entityId: payment.id,
      after: payment
    });

    const outstanding = await getCustomerOutstanding(tx, customer.id);
    return {
      payment: {
        id: payment.id,
        receiptNo: payment.receiptNo,
        customer,
        invoice: invoice ? { id: invoice.id, invoiceNo: invoice.invoiceNo } : null,
        amountPaise: payment.amountPaise,
        amountDisplay: moneyDisplay(payment.amountPaise),
        mode: payment.mode,
        reference: payment.reference,
        paymentDate: payment.paymentDate
      },
      customerBalance: {
        outstandingPaise: outstanding.outstandingPaise,
        creditPaise: outstanding.creditPaise,
        outstandingDisplay: outstanding.outstandingDisplay
      }
    };
  }, { maxWait: 60000, timeout: 60000 });
}

export async function getCustomerOutstanding(db, customerId) {
  assertId(customerId, 'customerId');
  const [customer, invoices, paymentTotals, payments] = await Promise.all([
    db.customer.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, type: true }
    }),
    db.invoice.findMany({
      where: { customerId, status: 'POSTED' },
      select: {
        id: true,
        invoiceNo: true,
        issueDate: true,
        totalPaise: true
      },
      orderBy: [{ issueDate: 'desc' }, { id: 'desc' }]
    }),
    Promise.all([
      db.payment.aggregate({
        where: { customerId },
        _sum: { amountPaise: true }
      }),
      db.payment.groupBy({
        by: ['invoiceId'],
        where: { customerId, invoiceId: { not: null } },
        _sum: { amountPaise: true }
      })
    ]),
    db.payment.findMany({
      where: { customerId },
      select: {
        id: true,
        receiptNo: true,
        paymentDate: true,
        amountPaise: true,
        mode: true,
        reference: true,
        invoice: { select: { invoiceNo: true } }
      },
      orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }]
    })
  ]);
  if (!customer) {
    throw notFound('Customer not found');
  }

  const [paymentAggregate, linkedPayments] = paymentTotals;
  const paidByInvoice = new Map(
    linkedPayments.map((entry) => [
      entry.invoiceId,
      safeSum(entry._sum.amountPaise, 'Invoice payments')
    ])
  );
  const paidPaise = safeSum(paymentAggregate._sum.amountPaise, 'Customer payments');
  const invoicedPaise = invoices.reduce(
    (total, invoice) => safeSum(total + invoice.totalPaise, 'Posted invoice total'),
    0
  );
  const balance = customerBalance({ postedInvoicesPaise: invoicedPaise, paymentsPaise: paidPaise });
  const postedInvoicePayments = invoices.reduce(
    (total, invoice) => safeSum(total + (paidByInvoice.get(invoice.id) ?? 0), 'Posted invoice payments'),
    0
  );

  return {
    customer,
    invoicedPaise,
    invoicedDisplay: moneyDisplay(invoicedPaise),
    paidPaise,
    paidDisplay: moneyDisplay(paidPaise),
    outstandingPaise: balance.outstandingPaise,
    outstandingDisplay: moneyDisplay(balance.outstandingPaise),
    creditPaise: balance.creditPaise,
    creditDisplay: moneyDisplay(balance.creditPaise),
    invoices: invoices.map((invoice) => {
      const invoicePaid = paidByInvoice.get(invoice.id) ?? 0;
      const duePaise = Math.max(0, invoice.totalPaise - invoicePaid);
      return {
        ...invoice,
        totalDisplay: moneyDisplay(invoice.totalPaise),
        paidPaise: invoicePaid,
        paidDisplay: moneyDisplay(invoicePaid),
        duePaise,
        dueDisplay: moneyDisplay(duePaise),
        status: invoiceStatus(invoice.totalPaise, invoicePaid)
      };
    }),
    unallocatedPaidPaise: paidPaise - postedInvoicePayments,
    unallocatedPaidDisplay: moneyDisplay(paidPaise - postedInvoicePayments),
    payments: payments.map(({ invoice, ...payment }) => ({
      ...payment,
      invoiceNo: invoice?.invoiceNo ?? null,
      amountDisplay: moneyDisplay(payment.amountPaise)
    }))
  };
}

export async function listOutstanding(db) {
  const [invoiceRows, paymentRows] = await Promise.all([
    db.$queryRaw`
      SELECT c.id, c.name, c.type,
        COALESCE(SUM(i."totalPaise"), 0)::bigint AS "invoicedPaise"
      FROM "Customer" c
      LEFT JOIN "Invoice" i
        ON i."customerId" = c.id AND i.status = 'POSTED'
      GROUP BY c.id, c.name, c.type
    `,
    db.$queryRaw`
      SELECT "customerId",
        COALESCE(SUM("amountPaise"), 0)::bigint AS "paidPaise"
      FROM "Payment"
      GROUP BY "customerId"
    `
  ]);
  const paymentsByCustomer = new Map(
    paymentRows.map((row) => [row.customerId, safeSum(row.paidPaise, 'Customer payments')])
  );
  const balances = invoiceRows.map((row) => {
    const invoicedPaise = safeSum(row.invoicedPaise, 'Posted invoice total');
    const paidPaise = paymentsByCustomer.get(row.id) ?? 0;
    const balance = customerBalance({ postedInvoicesPaise: invoicedPaise, paymentsPaise: paidPaise });
    return {
      customer: { id: row.id, name: row.name, type: row.type },
      invoicedPaise,
      invoicedDisplay: moneyDisplay(invoicedPaise),
      paidPaise,
      paidDisplay: moneyDisplay(paidPaise),
      ...balance,
      outstandingDisplay: moneyDisplay(balance.outstandingPaise),
      creditDisplay: moneyDisplay(balance.creditPaise)
    };
  });
  const items = balances.filter((entry) => entry.outstandingPaise > 0)
    .sort((left, right) => right.outstandingPaise - left.outstandingPaise);
  const totals = balances.reduce((result, item) => ({
    invoicedPaise: result.invoicedPaise + item.invoicedPaise,
    paidPaise: result.paidPaise + item.paidPaise,
    outstandingPaise: result.outstandingPaise + item.outstandingPaise,
    creditPaise: result.creditPaise + item.creditPaise
  }), { invoicedPaise: 0, paidPaise: 0, outstandingPaise: 0, creditPaise: 0 });
  return {
    items,
    totals: {
      ...totals,
      invoicedDisplay: moneyDisplay(totals.invoicedPaise),
      paidDisplay: moneyDisplay(totals.paidPaise),
      outstandingDisplay: moneyDisplay(totals.outstandingPaise),
      creditDisplay: moneyDisplay(totals.creditPaise)
    }
  };
}

export async function listPayments(db, input) {
  const { gte, lt } = istDayRange(input.from, input.to);
  const paymentDate = {};
  if (gte) paymentDate.gte = gte;
  if (lt) paymentDate.lt = lt;
  const where = {
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    ...(input.invoiceId !== undefined ? { invoiceId: input.invoiceId } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(Object.keys(paymentDate).length ? { paymentDate } : {})
  };
  const [payments, total, amount] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      include: {
        customer: { select: { id: true, name: true, type: true } },
        invoice: { select: { id: true, invoiceNo: true } }
      }
    }),
    db.payment.count({ where }),
    db.payment.aggregate({ where, _sum: { amountPaise: true } })
  ]);
  const totalAmountPaise = safeSum(amount._sum.amountPaise, 'Filtered payments');
  return {
    items: payments.map((payment) => ({
      ...payment,
      amountDisplay: moneyDisplay(payment.amountPaise)
    })),
    page: input.page,
    limit: input.limit,
    total,
    totalAmountPaise,
    totalAmountDisplay: moneyDisplay(totalAmountPaise)
  };
}
