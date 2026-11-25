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

router.get(
  '/:id',
  authenticate,
  requireCapability('invoices:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getInvoiceDetails(prisma, req.params.id));
  })
);

export default router;
