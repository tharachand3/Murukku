import { apiGet, apiPost } from './benchmark.js';

function requireStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}`);
  }
}

export async function createDistributorInvoice(app, ctx, { approvedQty = 88 } = {}) {
  const orderResponse = await apiGet(
    app,
    ctx.tokens.admin,
    `/api/orders/${ctx.ids.orderB}`
  );
  requireStatus(orderResponse, 200, 'Read Distributor B order for approval');
  const line = orderResponse.body.lines?.[0];
  if (!Number.isSafeInteger(line?.lineId)) {
    throw new Error('Distributor B order did not return a valid lineId');
  }
  const approval = await apiPost(app, ctx.tokens.admin, `/api/orders/${ctx.ids.orderB}/approve`, {
    lines: [{ lineId: line.lineId, approvedQty }]
  });
  requireStatus(approval, 200, 'Approve Distributor B order quantity');
  const invoice = await apiPost(app, ctx.tokens.admin, '/api/invoices', {
    orderId: ctx.ids.orderB
  });
  requireStatus(invoice, 201, 'Create Distributor B invoice');
  return { orderId: ctx.ids.orderB, invoiceId: invoice.body.id };
}

export async function cancelInvoiceViaApi(app, ctx, invoiceId, reason = 'Test cancellation') {
  const response = await apiPost(app, ctx.tokens.admin, `/api/invoices/${invoiceId}/cancel`, {
    reason
  });
  requireStatus(response, 200, 'Cancel invoice through public API');
  return response.body;
}

export async function backdateInvoice(prisma, invoiceId, { daysAgo }) {
  if (!Number.isSafeInteger(daysAgo) || daysAgo < 0) {
    throw new RangeError('daysAgo must be a non-negative integer');
  }
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return prisma.invoice.update({
    where: { id: invoiceId },
    data: { issueDate: date }
  });
}

export async function runSecondProductionRun(app, ctx) {
  const started = await apiPost(app, ctx.tokens.production, '/api/production/runs', {
    finishedItemId: ctx.ids.murukku,
    batchCount: '0.5'
  });
  requireStatus(started, 201, 'Start second production run');
  const completed = await apiPost(
    app,
    ctx.tokens.production,
    `/api/production/runs/${started.body.id}/complete`,
    {
      actualGoodQty: 100,
      consumption: [
        { itemId: ctx.ids.pouch, qty: '100', unit: 'pcs' },
        { itemId: ctx.ids.carton, qty: '5', unit: 'pcs' }
      ]
    }
  );
  requireStatus(completed, 200, 'Complete second production run');
  return { runId: started.body.id };
}
