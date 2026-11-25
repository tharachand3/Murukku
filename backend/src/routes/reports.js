import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { CAPABILITY_MATRIX } from '../config/permissions.js';
import { AppError } from '../lib/errors.js';
import { formatIstDate } from '../lib/reportKit.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { reportDefs } from '../services/reports/index.js';
import { toCsv } from '../services/reports/exporters/csv.js';
import { toXlsx } from '../services/reports/exporters/xlsx.js';
import { toPdf } from '../services/reports/exporters/pdf.js';
import { assertExportRowCap } from '../services/reports/exporters/cap.js';

const router = Router();

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const reports = reportDefs
      .filter((definition) => CAPABILITY_MATRIX[definition.capability]?.includes(req.user.role))
      .map(({ key, title, description, group, capability, filterDocs, sectionDocs }) => ({
        key,
        title,
        description,
        group,
        capability,
        filters: filterDocs,
        exportFormats: ['csv', 'xlsx', 'pdf'],
        sections: sectionDocs ?? []
      }));
    res.json(reports);
  })
);

for (const definition of reportDefs) {
  router.get(
    `/${definition.key}/export`,
    authenticate,
    requireCapability(definition.capability),
    asyncHandler(async (req, res) => {
      const optionsResult = z.object({
        format: z.enum(['csv', 'xlsx', 'pdf']).default('csv'),
        section: z.string().min(1).optional()
      }).strict().safeParse({
        format: req.query.format,
        ...(req.query.section !== undefined ? { section: req.query.section } : {})
      });
      if (!optionsResult.success) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Invalid request',
          optionsResult.error.issues.map((issue) => ({
            path: ['query', ...issue.path].join('.'),
            message: issue.message
          }))
        );
      }
      const { format, section } = optionsResult.data;
      if (section !== undefined && format !== 'csv') {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [{
          path: 'query.section',
          message: 'Section can only be used with CSV exports'
        }]);
      }

      const remainingQuery = { ...req.query };
      delete remainingQuery.format;
      delete remainingQuery.section;
      delete remainingQuery.page;
      delete remainingQuery.limit;
      const filtersResult = definition.filtersSchema.safeParse(remainingQuery);
      if (!filtersResult.success) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Invalid request',
          filtersResult.error.issues.map((issue) => ({
            path: ['query', ...issue.path].join('.'),
            message: issue.message
          }))
        );
      }
      const filters = { ...filtersResult.data };

      const result = await definition.run(prisma, filters, { all: true });
      const sections = result.sections.map((entry) => ({
        ...entry,
        rows: [...entry.rows]
      }));
      const pageCount = Math.max(
        1,
        ...sections.map((entry) => entry.page?.pages ?? 1)
      );
      const pageLimit = Math.min(
        200,
        ...sections
          .filter((entry) => entry.page)
          .map((entry) => entry.page.limit)
      );
      if (pageCount > 1) {
        for (let page = 2; page <= pageCount; page += 1) {
          const nextResult = await definition.run(
            prisma,
            { ...filters, page, limit: pageLimit },
            { all: true }
          );
          for (const current of sections) {
            const next = nextResult.sections.find(({ key }) => key === current.key);
            if (current.page && next?.page) current.rows.push(...next.rows);
          }
        }
      }
      for (const entry of sections) assertExportRowCap(entry.rows.length);

      const generatedAt = new Date();
      const exportResult = {
        ...result,
        filters,
        generatedAt: generatedAt.toISOString(),
        sections
      };
      const buffer = format === 'csv'
        ? toCsv(exportResult, { sectionKey: section })
        : format === 'xlsx'
          ? await toXlsx(exportResult)
          : await toPdf(exportResult);
      const period = result.period;
      const datePart = period?.from && period?.to
        ? `${period.from}_${period.to}`
        : formatIstDate(generatedAt);
      const filename = `${definition.key}_${datePart}.${format}`
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '_');
      const contentTypes = {
        csv: 'text/csv; charset=utf-8',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        pdf: 'application/pdf'
      };
      res.set({
        'Content-Type': contentTypes[format],
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store'
      });
      res.end(buffer);
    })
  );

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
