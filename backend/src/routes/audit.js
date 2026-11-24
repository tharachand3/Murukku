import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
const auditQuerySchema = z.object({
  entity: z.string().trim().min(1).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50)
}).superRefine((query, context) => {
  if (query.from && query.to && query.from > query.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`from` must be earlier than or equal to `to`',
      path: ['from']
    });
  }
});

router.get(
  '/',
  authenticate,
  requireCapability('audit:read'),
  validate({ query: auditQuerySchema }),
  asyncHandler(async (req, res) => {
    const { entity, entityId, userId, from, to, page, limit } = req.query;
    const createdAt = {};
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;

    const where = {
      ...(entity !== undefined ? { entity } : {}),
      ...(entityId !== undefined ? { entityId } : {}),
      ...(userId !== undefined ? { userId } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {})
    };

    const items = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { name: true } } }
    });

    res.json({ items, page, limit });
  })
);

export default router;
