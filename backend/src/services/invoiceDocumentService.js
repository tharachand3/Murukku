import { AppError } from '../lib/errors.js';
import { paiseToWords } from '../lib/amountInWords.js';
import { STATES } from '../lib/states.js';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});

function displayDate(value) {
  return DATE_FORMATTER.format(value).replaceAll(' ', '-');
}

function stateDisplay(code, stateName) {
  const name = STATES[code] ?? stateName;
  return name ? `${code}-${name}` : code;
}

function percentageFromBasisPoints(basisPoints) {
  const whole = Math.floor(basisPoints / 100);
  const fraction = String(basisPoints % 100).padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function sumSafe(values) {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) {
      throw new AppError(500, 'INVOICE_TOTAL_MISMATCH', 'Invoice contains an invalid amount');
    }
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new AppError(500, 'INVOICE_TOTAL_MISMATCH', 'Invoice amount exceeds the supported range');
    }
  }
  return total;
}

function settingValues(settings) {
  return Object.fromEntries(settings.map(({ key, value }) => [key, value]));
}

export async function getInvoiceDocument(db, invoiceId) {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: {
        select: {
          name: true,
          gstin: true,
          stateCode: true,
          stateName: true,
          address: true,
          phone: true
        }
      },
      order: { select: { orderNo: true } },
      lines: {
        orderBy: { id: 'asc' },
        include: { item: { select: { displayUnit: { select: { code: true } } } } }
      },
      dispatches: {
        orderBy: [{ dispatchDate: 'asc' }, { id: 'asc' }],
        select: { dispatchNo: true, dispatchDate: true }
      },
      creditNotes: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { noteNo: true, reason: true, createdAt: true }
      }
    }
  });
  if (!invoice) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const settings = settingValues(await db.setting.findMany({
    where: {
      key: {
        in: ['COMPANY_NAME', 'COMPANY_GSTIN', 'COMPANY_STATE_CODE', 'COMPANY_ADDRESS']
      }
    },
    select: { key: true, value: true }
  }));
  const seller = invoice.snapshot?.seller ?? {};
  const buyer = invoice.snapshot?.buyer ?? {};
  const lines = invoice.lines.map((line, index) => ({
    srNo: index + 1,
    description: line.description,
    hsnCode: line.hsnCode,
    qty: line.qty,
    unit: line.item.displayUnit.code,
    ratePaise: line.ratePaise,
    taxableValuePaise: line.taxableValuePaise,
    gstRatePct: percentageFromBasisPoints(line.gstRateBp),
    cgstPaise: line.cgstPaise,
    sgstPaise: line.sgstPaise,
    igstPaise: line.igstPaise,
    totalPaise: line.totalPaise
  }));
  const totals = {
    taxableValuePaise: sumSafe(lines.map(({ taxableValuePaise }) => taxableValuePaise)),
    cgstPaise: sumSafe(lines.map(({ cgstPaise }) => cgstPaise)),
    sgstPaise: sumSafe(lines.map(({ sgstPaise }) => sgstPaise)),
    igstPaise: sumSafe(lines.map(({ igstPaise }) => igstPaise)),
    totalPaise: sumSafe(lines.map(({ totalPaise }) => totalPaise))
  };
  for (const key of Object.keys(totals)) {
    if (totals[key] !== invoice[key]) {
      throw new AppError(
        500,
        'INVOICE_TOTAL_MISMATCH',
        'Invoice line totals do not match the stored invoice header'
      );
    }
  }

  const summaryByRate = new Map();
  for (const line of lines) {
    const current = summaryByRate.get(line.gstRatePct) ?? {
      ratePct: line.gstRatePct,
      taxableValuePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0
    };
    current.taxableValuePaise += line.taxableValuePaise;
    current.cgstPaise += line.cgstPaise;
    current.sgstPaise += line.sgstPaise;
    current.igstPaise += line.igstPaise;
    summaryByRate.set(line.gstRatePct, current);
  }
  const cancellationNote = invoice.creditNotes[0] ?? null;
  const stateCode = invoice.placeOfSupplyStateCode;
  const customerStateCode = buyer.stateCode ?? invoice.customer.stateCode;
  const companyStateCode = seller.stateCode ?? settings.COMPANY_STATE_CODE ?? '';

  return {
    company: {
      name: seller.name ?? settings.COMPANY_NAME ?? '',
      gstin: seller.gstin ?? settings.COMPANY_GSTIN ?? '',
      stateCode: companyStateCode,
      stateDisplay: stateDisplay(companyStateCode, seller.stateName),
      address: seller.address ?? settings.COMPANY_ADDRESS ?? ''
    },
    invoice: {
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      financialYear: invoice.financialYear,
      issueDateDisplay: displayDate(invoice.issueDate),
      status: invoice.status
    },
    supply: {
      placeOfSupply: stateDisplay(stateCode, STATES[stateCode]),
      taxType: invoice.isInterState ? 'IGST' : 'CGST+SGST',
      reverseCharge: 'No'
    },
    customer: {
      name: buyer.name ?? invoice.customer.name,
      gstin: buyer.gstin ?? invoice.customer.gstin,
      address: buyer.address ?? invoice.customer.address,
      phone: invoice.customer.phone,
      stateDisplay: stateDisplay(customerStateCode, buyer.stateName ?? invoice.customer.stateName)
    },
    orderNo: invoice.snapshot?.orderNo ?? invoice.order?.orderNo ?? null,
    dispatches: invoice.dispatches.map((dispatch) => ({
      dispatchNo: dispatch.dispatchNo,
      dispatchDateDisplay: displayDate(dispatch.dispatchDate)
    })),
    lines,
    taxSummary: [...summaryByRate.values()].sort(
      (left, right) => Number(left.ratePct) - Number(right.ratePct)
    ),
    totals,
    amountInWords: paiseToWords(totals.totalPaise),
    cancellation: invoice.status === 'CANCELLED'
      ? {
          creditNoteNo: cancellationNote?.noteNo ?? null,
          cancelledAtDisplay: displayDate(invoice.cancelledAt ?? cancellationNote?.createdAt),
          reason: cancellationNote?.reason ?? invoice.cancelReason
        }
      : null,
    notes: ['This is a computer generated invoice and needs no signature.']
  };
}
