import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { verifyInvoiceLinkToken } from '../lib/shareToken.js';
import { getInvoiceDocument } from '../services/invoiceDocumentService.js';
import { renderInvoicePdf } from '../services/invoicePdfService.js';

const router = Router();

router.get(
  '/invoices/:token/pdf',
  asyncHandler(async (req, res) => {
    const invoiceId = verifyInvoiceLinkToken(req.params.token);
    const model = await getInvoiceDocument(prisma, invoiceId);
    const buffer = await renderInvoicePdf(model);
    const filename = `${model.invoice.invoiceNo.replaceAll('/', '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.end(buffer);
  })
);

export default router;
