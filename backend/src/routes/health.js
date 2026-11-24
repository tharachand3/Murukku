import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

router.get('/health', asyncHandler(async (_req, res) => {
  let db = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = false;
  }

  res.json({ ok: true, db, time: new Date().toISOString() });
}));

export default router;
