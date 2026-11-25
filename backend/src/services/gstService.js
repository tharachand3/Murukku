import { AppError, badRequest, notFound } from '../lib/errors.js';
import { buildInvoiceLines } from '../lib/invoiceMath.js';
import { paiseToRupeesString } from '../lib/money.js';
import { effectivePricePaise, effectiveQty } from '../lib/orderMath.js';

const SELLER_SETTING_KEYS = [
  'COMPANY_NAME',
  'COMPANY_GSTIN',
  'COMPANY_STATE_CODE',
  'COMPANY_ADDRESS'
];

function paiseDisplay(value) {
  return `Rs ${paiseToRupeesString(value)}`;
}

function addLineDisplays(line) {
  return {
    ...line,
    rateDisplay: paiseDisplay(line.ratePaise),
    taxableValueDisplay: paiseDisplay(line.taxableValuePaise),
    cgstDisplay: paiseDisplay(line.cgstPaise),
    sgstDisplay: paiseDisplay(line.sgstPaise),
    igstDisplay: paiseDisplay(line.igstPaise),
    totalDisplay: paiseDisplay(line.totalPaise)
  };
}

function addTotalDisplays(totals) {
  return {
    ...totals,
    taxableValueDisplay: paiseDisplay(totals.taxableValuePaise),
    cgstDisplay: paiseDisplay(totals.cgstPaise),
    sgstDisplay: paiseDisplay(totals.sgstPaise),
    igstDisplay: paiseDisplay(totals.igstPaise),
    totalDisplay: paiseDisplay(totals.totalPaise)
  };
}

export async function getSellerInfo(db) {
  const settings = await db.setting.findMany({
    where: { key: { in: SELLER_SETTING_KEYS } },
    select: { key: true, value: true }
  });
  const values = new Map(settings.map(({ key, value }) => [key, value]));
  const stateCode = values.get('COMPANY_STATE_CODE');
  if (typeof stateCode !== 'string' || stateCode.trim() === '') {
    throw new AppError(
      422,
      'SETTING_MISSING',
      'Company state code is not configured',
      { key: 'COMPANY_STATE_CODE' }
    );
  }

  return {
    name: values.get('COMPANY_NAME') ?? null,
    gstin: values.get('COMPANY_GSTIN') ?? null,
    stateCode: stateCode.trim(),
    address: values.get('COMPANY_ADDRESS') ?? null
  };
}

export async function buildOrderInvoiceDraft(db, orderId, { qtyOverrides } = {}) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    throw badRequest('orderId must be a positive integer');
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          gstin: true,
          stateCode: true,
          stateName: true,
          address: true
        }
      },
      lines: {
        orderBy: { id: 'asc' },
        include: {
          item: {
            select: { name: true, hsnCode: true, gstRateBp: true }
          }
        }
      }
    }
  });
  if (!order) {
    throw notFound('Order not found');
  }
  if (!['SUBMITTED', 'APPROVED'].includes(order.status)) {
    throw new AppError(
      409,
      'INVALID_STATUS',
      `Cannot preview an invoice for an order in ${order.status} status`,
      { from: order.status, to: 'INVOICED' }
    );
  }

  const seller = await getSellerInfo(db);
  const lines = order.lines.flatMap((line) => {
    const qty = qtyOverrides?.has(line.itemId)
      ? qtyOverrides.get(line.itemId)
      : effectiveQty(line);
    if (!Number.isSafeInteger(qty) || qty < 0) {
      throw new RangeError('Invoice quantity must be a non-negative safe integer');
    }
    if (qty === 0) {
      return [];
    }
    return [{
      itemId: line.itemId,
      description: line.item.name,
      hsnCode: line.item.hsnCode,
      qty,
      ratePaise: effectivePricePaise(line),
      gstRateBp: line.item.gstRateBp
    }];
  });
  const invoice = buildInvoiceLines({
    lines,
    sellerStateCode: seller.stateCode,
    placeOfSupplyStateCode: order.customer.stateCode
  });

  return {
    orderId: order.id,
    orderNo: order.orderNo,
    customer: order.customer,
    seller,
    placeOfSupplyStateCode: order.customer.stateCode,
    isInterState: invoice.isInterState,
    lines: invoice.lines.map(addLineDisplays),
    totals: addTotalDisplays(invoice.totals)
  };
}
