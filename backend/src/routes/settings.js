import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getSettings, putSetting, SETTING_KEYS } from '../services/settingsService.js';

const router = Router();
const settingKeySchema = z.object({
  key: z.enum(SETTING_KEYS)
});
const settingBodySchema = z.object({
  value: z.union([
    z.string().trim().min(1),
    z.number().int()
  ]).transform(String)
});

router.get(
  '/',
  authenticate,
  requireCapability('masters:read'),
  asyncHandler(async (_req, res) => {
    res.json(await getSettings(prisma));
  })
);

router.put(
  '/:key',
  authenticate,
  requireCapability('masters:write'),
  validate({ params: settingKeySchema, body: settingBodySchema }),
  asyncHandler(async (req, res) => {
    res.json(await putSetting(req.user.id, req.params.key, req.body.value));
  })
);

export default router;
