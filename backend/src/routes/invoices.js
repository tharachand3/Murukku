import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { isValidIstDate } from '../lib/istDate.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { prisma } from '../lib/prisma.js';
import {
  createInvoice,
  getInvoiceDetails,
  listInvoices
} from '../services/invoiceService.js';
import { getInvoiceDispatchStatus } from '../services/dispatchService.js';
import { getInvoiceDocument } from '../services/invoiceDocumentService.js';
import { renderInvoicePdf } from '../services/invoicePdfService.js';
import { signInvoiceLinkToken } from '../lib/shareToken.js';
import { buildMailtoUrl, buildWhatsappUrl } from '../lib/shareLinks.js';
import { config } from '../config/env.js';
import { paiseToRupeesString } from '../lib/money.js';
import {
  cancelInvoice,
  cancelInvoiceSchema,
  getCreditNoteForInvoice
} from '../services/creditNoteService.js';

const router = Router();
const dateSchema = z.string().refine(
  isValidIstDate,
  'Expected a valid YYYY-MM-DD date'
);
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647)
});
const createInvoiceSchema = z.object({
  orderId: z.number().int().positive().max(2147483647)
}).strict();
const listQuerySchema = z.object({
  status: z.enum(['POSTED', 'CANCELLED']).optional(),
  customerId: z.coerce.number().int().positive().max(2147483647).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
}).superRefine((query, context) => {
  if (query.from && query.to && query.from > query.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`from` must be earlier than or equal to `to`',
      path: ['from']
    });
  }
});

const pdfQuerySchema = z.object({
  disposition: z.enum(['attachment', 'inline']).default('attachment')
}).strict();

router.get(
  '/:id/pdf',
  authenticate,
  requireCapability('invoices:read'),
  validate({ params: idParamsSchema, query: pdfQuerySchema }),
  asyncHandler(async (req, res) => {
    const model = await getInvoiceDocument(prisma, req.params.id);
    const buffer = await renderInvoicePdf(model);
    const filename = `${model.invoice.invoiceNo.replaceAll('/', '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${req.query.disposition}; filename="${filename}"`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buffer);
  })
);

router.get(
  '/:id/share',
  authenticate,
  requireCapability('invoices:write'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    const model = await getInvoiceDocument(prisma, req.params.id);
    const now = new Date();
    const ttlSeconds = 604800;
    const token = signInvoiceLinkToken(model.invoice.id, { now, ttlSeconds });
    const base = (config.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get('host')}`)
      .replace(/\/+$/, '');
    const pdfUrl = `${base}/api/public/invoices/${token}/pdf`;
    const text = `Hello ${model.customer.name}, your tax invoice ${model.invoice.invoiceNo} dated ${model.invoice.issueDateDisplay} for Rs ${paiseToRupeesString(model.totals.totalPaise)} is ready: ${pdfUrl}`;
    const expiresAt = new Date(
      (Math.floor(now.getTime() / 1000) + ttlSeconds) * 1000
    ).toISOString();
    res.json({
      invoiceNo: model.invoice.invoiceNo,
      customer: { name: model.customer.name, phone: model.customer.phone },
      expiresAt,
      pdfUrl,
      whatsappUrl: buildWhatsappUrl({ phone: model.customer.phone, text }),
      mailtoUrl: buildMailtoUrl({
        subject: `Tax invoice ${model.invoice.invoiceNo}`,
        body: text
      }),
      text
    });
  })
);

router.post(
  '/',
  authenticate,
  requireCapability('invoices:write'),
  validate({ body: createInvoiceSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createInvoice(req.user, req.body));
  })
);

router.get(
  '/',
  authenticate,
  requireCapability('invoices:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listInvoices(prisma, req.query));
  })
);

router.post(
  '/:id/cancel',
  authenticate,
  requireCapability('invoices:write'),
  validate({ params: idParamsSchema, body: cancelInvoiceSchema }),
  asyncHandler(async (req, res) => {
    res.json(await cancelInvoice(req.user, req.params.id, req.body));
  })
);

router.get(
  '/:id/dispatch-status',
  authenticate,
  requireCapability('invoices:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getInvoiceDispatchStatus(prisma, req.params.id));
  })
);

router.get(
  '/:id',
  authenticate,
  requireCapability('invoices:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    const [invoice, creditNote] = await Promise.all([
      getInvoiceDetails(prisma, req.params.id),
      getCreditNoteForInvoice(prisma, req.params.id)
    ]);
    res.json({ ...invoice, creditNote });
  })
);

export default router;
