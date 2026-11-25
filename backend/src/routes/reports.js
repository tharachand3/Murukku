import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { CAPABILITY_MATRIX } from '../config/permissions.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { reportDefs } from '../services/reports/index.js';

const router = Router();

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const reports = reportDefs
      .filter((definition) => CAPABILITY_MATRIX[definition.capability]?.includes(req.user.role))
      .map(({ key, title, description, group, capability, filterDocs }) => ({
        key,
        title,
        description,
        group,
        capability,
        filters: filterDocs
      }));
    res.json(reports);
  })
);

for (const definition of reportDefs) {
  router.get(
    `/${definition.key}`,
    authenticate,
    requireCapability(definition.capability),
    validate({ query: definition.filtersSchema }),
    asyncHandler(async (req, res) => {
      const result = await definition.run(prisma, req.query, { all: false });
      res.json({
        report: {
          key: definition.key,
          title: definition.title,
          description: definition.description,
          group: definition.group
        },
        filters: req.query,
        period: result.period,
        generatedAt: new Date().toISOString(),
        sections: result.sections
      });
    })
  );
}

export default router;
