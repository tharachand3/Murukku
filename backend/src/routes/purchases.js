import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createPurchase,
  getPurchase,
  listPurchases
} from '../services/purchaseService.js';

const router = Router();
const decimalString = /^\d+(?:\.\d+)?$/;
const purchaseLineSchema = z.object({
  itemId: z.coerce.number().int().positive().max(2147483647),
  qty: z.string().trim().regex(decimalString),
  unit: z.string().trim().min(1),
  ratePerUnitRupees: z.string().trim().regex(decimalString),
  batchNo: z.string().trim().nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional()
});
const createPurchaseSchema = z.object({
  supplierId: z.coerce.number().int().positive().max(2147483647),
  purchaseDate: z.coerce.date().optional(),
  supplierInvoiceNo: z.string().trim().min(1).nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(purchaseLineSchema).min(1)
});
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647)
});
const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  supplierId: z.coerce.number().int().positive().max(2147483647).optional()
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
  requireCapability('purchases:write'),
  validate({ body: createPurchaseSchema }),
  asyncHandler(async (req, res) => {
    const purchase = await createPurchase(req.user.id, req.body);
    res.status(201).json(purchase);
  })
);

router.get(
  '/',
  authenticate,
  requireCapability('purchases:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listPurchases(prisma, req.query));
  })
);

router.get(
  '/:id',
  authenticate,
  requireCapability('purchases:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getPurchase(prisma, req.params.id));
  })
);

export default router;
