import { describe, expect, it, vi } from 'vitest';
import { financialYearOf } from '../src/lib/fy.js';
import { getInvoiceDocument } from '../src/services/invoiceDocumentService.js';

function makeInvoice(overrides = {}) {
  const line = {
    id: 1,
    description: 'Murukku 200 g',
    hsnCode: '21069099',
    qty: 150,
    ratePaise: 5000,
    taxableValuePaise: 750000,
    gstRateBp: 500,
    cgstPaise: 18750,
    sgstPaise: 18750,
    igstPaise: 0,
    totalPaise: 787500,
    item: { displayUnit: { code: 'packet' } }
  };
  return {
    id: 1,
    invoiceNo: `INV/${financialYearOf(new Date())}/0001`,
    financialYear: financialYearOf(new Date()),
    issueDate: new Date(),
    placeOfSupplyStateCode: '33',
    isInterState: false,
    taxableValuePaise: 750000,
    cgstPaise: 18750,
    sgstPaise: 18750,
    igstPaise: 0,
    totalPaise: 787500,
    status: 'POSTED',
    cancelledAt: null,
    cancelReason: null,
    snapshot: {
      seller: {
        name: 'Sri Murugan Snacks (Demo)',
        gstin: '33ABCDE1234F1Z5',
        stateCode: '33',
        address: 'Demo address'
      },
      buyer: {
        id: 10,
        name: 'Retailer A',
        gstin: '33AAAAA0000A1Z5',
        stateCode: '33',
        stateName: 'Tamil Nadu',
        address: 'Retailer address'
      },
      orderNo: `ORD/${financialYearOf(new Date())}/0001`
    },
    customer: {
      name: 'Retailer A',
      gstin: '33AAAAA0000A1Z5',
      stateCode: '33',
      stateName: 'Tamil Nadu',
      address: 'Retailer address',
      phone: '98765 43210'
    },
    order: { orderNo: `ORD/${financialYearOf(new Date())}/0001` },
    lines: [line],
    dispatches: [{
      dispatchNo: `DSP/${financialYearOf(new Date())}/0001`,
      dispatchDate: new Date()
    }],
    creditNotes: [],
    ...overrides
  };
}

function fakeDb(invoice) {
  return {
    invoice: { findUnique: vi.fn(async () => invoice) },
    setting: {
      findMany: vi.fn(async () => [
        { key: 'COMPANY_NAME', value: 'Current Company Name' },
        { key: 'COMPANY_STATE_CODE', value: '29' }
      ])
    }
  };
}

describe('invoice document model', () => {
  it('builds the intra-state benchmark model from invoice snapshots', async () => {
    const model = await getInvoiceDocument(fakeDb(makeInvoice()), 1);
    expect(model).toMatchObject({
      company: {
        name: 'Sri Murugan Snacks (Demo)',
        gstin: '33ABCDE1234F1Z5',
        stateDisplay: '33-Tamil Nadu'
      },
      invoice: { invoiceNo: `INV/${financialYearOf(new Date())}/0001`, status: 'POSTED' },
      supply: { placeOfSupply: '33-Tamil Nadu', taxType: 'CGST+SGST', reverseCharge: 'No' },
      customer: {
        name: 'Retailer A',
        gstin: '33AAAAA0000A1Z5',
        phone: '98765 43210',
        stateDisplay: '33-Tamil Nadu'
      },
      orderNo: `ORD/${financialYearOf(new Date())}/0001`,
      lines: [{
        srNo: 1,
        description: 'Murukku 200 g',
        hsnCode: '21069099',
        qty: 150,
        unit: 'packet',
        ratePaise: 5000,
        taxableValuePaise: 750000,
        gstRatePct: '5',
        cgstPaise: 18750,
        sgstPaise: 18750,
        igstPaise: 0,
        totalPaise: 787500
      }],
      taxSummary: [{
        ratePct: '5',
        taxableValuePaise: 750000,
        cgstPaise: 18750,
        sgstPaise: 18750,
        igstPaise: 0
      }],
      totals: {
        taxableValuePaise: 750000,
        cgstPaise: 18750,
        sgstPaise: 18750,
        igstPaise: 0,
        totalPaise: 787500
      },
      amountInWords: 'Rupees Seven Thousand Eight Hundred Seventy Five Only',
      cancellation: null
    });
    expect(model.dispatches[0].dispatchNo).toMatch(/^DSP\/\d{4}-\d{2}\/0001$/);
    expect(model.invoice.issueDateDisplay).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4}$/);
  });

  it('builds the interstate totals and amount in words', async () => {
    const benchmark = makeInvoice({
      placeOfSupplyStateCode: '29',
      isInterState: true,
      taxableValuePaise: 440000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 22000,
      totalPaise: 462000,
      snapshot: {
        seller: { name: 'Sri Murugan Snacks (Demo)', stateCode: '33' },
        buyer: { name: 'Distributor B', stateCode: '29', stateName: 'Karnataka' }
      },
      customer: {
        name: 'Distributor B',
        stateCode: '29',
        stateName: 'Karnataka',
        phone: null
      },
      lines: [{
        id: 1,
        description: 'Murukku 200 g',
        hsnCode: '21069099',
        qty: 88,
        ratePaise: 5000,
        taxableValuePaise: 440000,
        gstRateBp: 500,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 22000,
        totalPaise: 462000,
        item: { displayUnit: { code: 'packet' } }
      }]
    });
    const model = await getInvoiceDocument(fakeDb(benchmark), 1);
    expect(model.supply).toMatchObject({
      placeOfSupply: '29-Karnataka',
      taxType: 'IGST'
    });
    expect(model.totals).toMatchObject({
      taxableValuePaise: 440000,
      igstPaise: 22000,
      totalPaise: 462000
    });
    expect(model.amountInWords).toBe('Rupees Four Thousand Six Hundred Twenty Only');
  });

  it('uses the stored buyer and line snapshots when current masters differ', async () => {
    const invoice = makeInvoice({
      customer: {
        name: 'Renamed customer',
        stateCode: '33',
        stateName: 'Tamil Nadu',
        phone: null
      },
      lines: [{
        ...makeInvoice().lines[0],
        item: { displayUnit: { code: 'packet' } }
      }]
    });
    const model = await getInvoiceDocument(fakeDb(invoice), 1);
    expect(model.customer.name).toBe('Retailer A');
    expect(model.lines[0]).toMatchObject({
      description: 'Murukku 200 g',
      ratePaise: 5000,
      taxableValuePaise: 750000
    });
  });

  it('refuses to render when any stored invoice header total differs', async () => {
    const invoice = makeInvoice({ totalPaise: 787501 });
    await expect(getInvoiceDocument(fakeDb(invoice), 1))
      .rejects.toMatchObject({ status: 500, code: 'INVOICE_TOTAL_MISMATCH' });
  });

  it('includes the stored credit note and cancellation details', async () => {
    const cancelledAt = new Date();
    const invoice = makeInvoice({
      status: 'CANCELLED',
      cancelledAt,
      cancelReason: 'Damaged goods',
      creditNotes: [{
        noteNo: `CN/${financialYearOf(new Date())}/0001`,
        reason: 'Damaged goods',
        createdAt: cancelledAt
      }]
    });
    const model = await getInvoiceDocument(fakeDb(invoice), 1);
    expect(model.cancellation).toMatchObject({
      creditNoteNo: `CN/${financialYearOf(new Date())}/0001`,
      reason: 'Damaged goods'
    });
  });

  it('returns 404 for an unknown invoice', async () => {
    const db = fakeDb(null);
    await expect(getInvoiceDocument(db, 999))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
