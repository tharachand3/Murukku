import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { getDashboardSummary } from '../services/dashboardService.js';

const router = Router();

router.get(
  '/summary',
  authenticate,
  requireCapability('dashboard:read'),
  asyncHandler(async (_req, res) => {
    res.json({
      generatedAt: new Date().toISOString(),
      ...await getDashboardSummary(prisma)
    });
  })
);

export default router;
