import { Router } from 'express';
import { z } from 'zod';
import { CAPABILITY_MATRIX } from '../config/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { notFound } from '../lib/errors.js';
import { formatQty } from '../lib/units.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createAdjustment, listAdjustments } from '../services/adjustmentService.js';
import { getBalances, getLedger } from '../services/ledgerService.js';
import { getFinishedAvailability } from '../services/stockService.js';

const router = Router();
const summaryQuerySchema = z.object({
  type: z.enum(['RAW', 'PACKAGING', 'FINISHED']).optional()
});
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});
const ledgerQuerySchema = z.object({
  itemId: z.coerce.number().int().positive(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
}).superRefine((query, context) => {
  if (query.from && query.to && query.from > query.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`from` must be earlier than or equal to `to`',
      path: ['from']
    });
  }
});
const adjustmentBodySchema = z.object({
  itemId: z.coerce.number().int().positive().max(2147483647),
  qty: z.string().trim().regex(/^\d+(?:\.\d+)?$/),
  unit: z.string().trim().min(1),
  direction: z.enum(['IN', 'OUT']),
  reason: z.enum(['DAMAGE', 'EXPIRY', 'COUNT_CORRECTION', 'SPILLAGE', 'OTHER']),
  note: z.string().trim().nullable().optional()
});
const adjustmentQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  itemId: z.coerce.number().int().positive().max(2147483647).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
}).superRefine((query, context) => {
  if (query.from && query.to && query.from > query.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`from` must be earlier than or equal to `to`',
      path: ['from']
    });
  }
});

const finishedStockRoles = requireRole(
  'SALESMAN',
  ...CAPABILITY_MATRIX['stock:read']
);

router.post(
  '/adjustments',
  authenticate,
  requireCapability('stock:adjust'),
  validate({ body: adjustmentBodySchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createAdjustment(req.user.id, req.body));
  })
);

router.get(
  '/adjustments',
  authenticate,
  requireCapability('stock:read'),
  validate({ query: adjustmentQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listAdjustments(prisma, req.query));
  })
);

router.get(
  '/summary',
  authenticate,
  requireCapability('stock:read'),
  validate({ query: summaryQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await getBalances(prisma, { type: req.query.type }));
  })
);

router.get(
  '/ledger',
  authenticate,
  requireCapability('stock:read'),
  validate({ query: ledgerQuerySchema }),
  asyncHandler(async (req, res) => {
    const item = await prisma.item.findUnique({
      where: { id: req.query.itemId },
      select: { displayUnit: { select: { code: true } } }
    });
    if (!item) {
      throw notFound('Item not found');
    }

    const ledger = await getLedger(prisma, req.query);
    const display = (qty) => formatQty(qty, item.displayUnit.code);
    res.json({
      ...ledger,
      displayUnit: item.displayUnit.code,
      openingBalanceDisplay: display(ledger.openingBalance),
      closingBalanceDisplay: display(ledger.closingBalance),
      rows: ledger.rows.map((row) => ({
        ...row,
        qtyInDisplay: display(row.qtyIn),
        qtyOutDisplay: display(row.qtyOut),
        balanceDisplay: display(row.balance)
      }))
    });
  })
);

router.get(
  '/items/:id/balance',
  authenticate,
  requireCapability('stock:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    const [balance] = await getBalances(prisma, { itemIds: [req.params.id] });
    if (!balance) {
      throw notFound('Item not found');
    }
    res.json(balance);
  })
);

router.get(
  '/finished-availability',
  authenticate,
  finishedStockRoles,
  asyncHandler(async (_req, res) => {
    res.json(await getFinishedAvailability(prisma));
  })
);

export default router;
