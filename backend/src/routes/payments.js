import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { isValidIstDate } from '../lib/istDate.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { prisma } from '../lib/prisma.js';
import {
  getCustomerOutstanding,
  listOutstanding,
  listPayments,
  paymentInputSchema,
  recordPayment
} from '../services/paymentService.js';

const router = Router();
const dateSchema = z.string().refine(
  isValidIstDate,
  'Expected a valid YYYY-MM-DD date'
);
const customerParamsSchema = z.object({
  customerId: z.coerce.number().int().positive().max(2147483647)
});
const paymentListQuerySchema = z.object({
  customerId: z.coerce.number().int().positive().max(2147483647).optional(),
  invoiceId: z.coerce.number().int().positive().max(2147483647).optional(),
  mode: z.enum(['CASH', 'UPI', 'BANK', 'CHEQUE']).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
}).strict().superRefine((query, context) => {
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
  requireCapability('payments:write'),
  validate({ body: paymentInputSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await recordPayment(req.user, req.body));
  })
);

router.get(
  '/outstanding',
  authenticate,
  requireCapability('payments:read'),
  asyncHandler(async (_req, res) => {
    res.json(await listOutstanding(prisma));
  })
);

router.get(
  '/outstanding/:customerId',
  authenticate,
  requireCapability('payments:read'),
  validate({ params: customerParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getCustomerOutstanding(prisma, req.params.customerId));
  })
);

router.get(
  '/',
  authenticate,
  requireCapability('payments:read'),
  validate({ query: paymentListQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listPayments(prisma, req.query));
  })
);

export default router;
