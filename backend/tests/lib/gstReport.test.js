import { describe, expect, it } from 'vitest';
import { buildGstSections, B2CL_THRESHOLD_PAISE } from '../../src/lib/gstReport.js';

function makeLine(overrides = {}) {
  return {
    hsnCode: '21069099',
    description: 'Murukku 200 g',
    uqc: 'PAC',
    qty: 150,
    gstRateBp: 500,
    taxableValuePaise: 750000,
    cgstPaise: 18750,
    sgstPaise: 18750,
    igstPaise: 0,
    totalPaise: 787500,
    ...overrides
  };
}

function makeInvoice(overrides = {}) {
  const invoice = {
    id: 1,
    invoiceNo: 'INV/2026-27/0001',
    issueDate: '2026-11-26',
    status: 'POSTED',
    isInterState: false,
    placeOfSupplyStateCode: '33',
    totalPaise: 787500,
    customer: { name: 'Retailer A', gstin: '33AAAAA0000A1Z5' },
    lines: [makeLine()],
    ...overrides
  };
  return invoice;
}

function makeCreditNote(invoice, overrides = {}) {
  return {
    noteNo: 'CN/2026-27/0001',
    noteDate: '2026-11-26',
    totalPaise: invoice.totalPaise,
    invoice,
    ...overrides
  };
}

function build(invoices = [], creditNotes = []) {
  return buildGstSections({
    invoices,
    creditNotes,
    sellerStateCode: '33'
  });
}

function section(sections, key) {
  return sections.find((candidate) => candidate.key === key);
}

function taxTotals(sections) {
  const rows = [
    ...section(sections, 'gstr1-b2b').rows,
    ...section(sections, 'gstr1-b2cl').rows,
    ...section(sections, 'gstr1-b2cs').rows
  ];
  return ['taxableValuePaise', 'igstPaise', 'cgstPaise', 'sgstPaise']
    .map((field) => rows.reduce((total, row) => total + row[field], 0));
}

describe('GST report aggregation', () => {
  it('builds registered B2B rows and the GSTR-3B outward figures', () => {
    const sections = build([makeInvoice()]);
    expect(section(sections, 'gstr1-b2b').rows).toEqual([{
      gstin: '33AAAAA0000A1Z5',
      receiverName: 'Retailer A',
      invoiceNo: 'INV/2026-27/0001',
      invoiceDate: '2026-11-26',
      invoiceValuePaise: 787500,
      placeOfSupply: '33-Tamil Nadu',
      reverseCharge: 'N',
      invoiceType: 'Regular',
      ratePct: '5',
      taxableValuePaise: 750000,
      igstPaise: 0,
      cgstPaise: 18750,
      sgstPaise: 18750,
      cessPaise: 0
    }]);
    expect(section(sections, 'gstr3b-outward').rows).toEqual([
      {
        description: 'Invoices issued',
        taxableValuePaise: 750000,
        igstPaise: 0,
        cgstPaise: 18750,
        sgstPaise: 18750,
        cessPaise: 0
      },
      {
        description: 'Less: credit notes',
        taxableValuePaise: 0,
        igstPaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        cessPaise: 0
      },
      {
        description: '3.1(a) Outward taxable supplies (net)',
        taxableValuePaise: 750000,
        igstPaise: 0,
        cgstPaise: 18750,
        sgstPaise: 18750,
        cessPaise: 0
      }
    ]);
  });

  it('classifies unregistered inter-state supplies with the named B2CL threshold', () => {
    const large = makeInvoice({
      id: 2,
      invoiceNo: 'INV/2026-27/0002',
      isInterState: true,
      placeOfSupplyStateCode: '29',
      totalPaise: 30000000,
      customer: { name: 'Large buyer', gstin: null },
      lines: [makeLine({
        qty: 1,
        taxableValuePaise: 30000000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 1500000,
        totalPaise: 31500000
      })]
    });
    const small = makeInvoice({
      id: 3,
      invoiceNo: 'INV/2026-27/0003',
      isInterState: true,
      placeOfSupplyStateCode: '29',
      totalPaise: 20000000,
      customer: { name: 'Small buyer', gstin: null },
      lines: [makeLine({
        qty: 1,
        taxableValuePaise: 20000000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 1000000,
        totalPaise: 21000000
      })]
    });
    const sections = build([large, small]);
    expect(B2CL_THRESHOLD_PAISE).toBe(25000000);
    expect(section(sections, 'gstr1-b2cl').rows[0]).toMatchObject({
      receiverName: 'Large buyer',
      placeOfSupply: '29-Karnataka',
      ratePct: '5',
      taxableValuePaise: 30000000,
      igstPaise: 1500000
    });
    expect(section(sections, 'gstr1-b2cs').rows).toEqual([{
      supplyType: 'Inter-State',
      placeOfSupply: '29-Karnataka',
      ratePct: '5',
      taxableValuePaise: 20000000,
      igstPaise: 1000000,
      cgstPaise: 0,
      sgstPaise: 0,
      cessPaise: 0
    }]);
    expect(section(sections, 'gstr3b-interstate-unregistered').rows).toEqual([{
      placeOfSupply: '29-Karnataka',
      taxableValuePaise: 50000000,
      igstPaise: 2500000
    }]);
  });

  it('nets same-period and prior-period credit notes into GSTR-3B and HSN', () => {
    const invoice = makeInvoice();
    const samePeriod = build([invoice], [makeCreditNote(invoice)]);
    expect(section(samePeriod, 'gstr3b-outward').rows[2]).toMatchObject({
      taxableValuePaise: 0,
      igstPaise: 0,
      cgstPaise: 0,
      sgstPaise: 0
    });
    expect(section(samePeriod, 'gstr1-cdnr').rows[0]).toMatchObject({
      noteValuePaise: 787500,
      taxableValuePaise: 750000,
      cgstPaise: 18750,
      sgstPaise: 18750
    });
    expect(section(samePeriod, 'gstr1-hsn').rows).toEqual([]);

    const earlierInvoice = makeInvoice({ issueDate: '2026-10-01' });
    const laterCredit = makeCreditNote(earlierInvoice, { noteDate: '2026-11-26' });
    const laterPeriod = build([], [laterCredit]);
    expect(section(laterPeriod, 'gstr3b-outward').rows[1]).toMatchObject({
      taxableValuePaise: -750000,
      cgstPaise: -18750,
      sgstPaise: -18750
    });
    expect(section(laterPeriod, 'gstr3b-outward').rows[2]).toMatchObject({
      taxableValuePaise: -750000,
      cgstPaise: -18750,
      sgstPaise: -18750
    });
    expect(section(laterPeriod, 'gstr1-hsn').rows[0]).toMatchObject({
      qty: -150,
      totalValuePaise: -787500,
      taxableValuePaise: -750000
    });
  });

  it('keeps rate-level invoice rows, merges HSN rows, and reconciles GSTR-1 totals', () => {
    const twoRateInvoice = makeInvoice({
      lines: [
        makeLine(),
        makeLine({
          hsnCode: '21069099',
          description: 'Murukku 200 g',
          qty: 10,
          gstRateBp: 250,
          taxableValuePaise: 10000,
          cgstPaise: 125,
          sgstPaise: 125,
          totalPaise: 10250
        })
      ],
      totalPaise: 797750
    });
    const secondInvoice = makeInvoice({
      id: 2,
      invoiceNo: 'INV/2026-27/0002',
      lines: [makeLine({
        qty: 50,
        taxableValuePaise: 250000,
        cgstPaise: 6250,
        sgstPaise: 6250,
        totalPaise: 262500
      })],
      totalPaise: 262500
    });
    const sections = build([twoRateInvoice, secondInvoice]);
    const b2b = section(sections, 'gstr1-b2b').rows;
    expect(b2b).toHaveLength(3);
    expect(b2b.filter((row) => row.invoiceNo === twoRateInvoice.invoiceNo)
      .map((row) => row.invoiceValuePaise)).toEqual([797750, 797750]);
    expect(b2b.map((row) => row.ratePct)).toEqual(['2.5', '5', '5']);
    expect(section(sections, 'gstr1-hsn').rows).toEqual([
      expect.objectContaining({
        hsnCode: '21069099',
        qty: 10,
        ratePct: '2.5'
      }),
      expect.objectContaining({
        hsnCode: '21069099',
        qty: 200,
        ratePct: '5',
        taxableValuePaise: 1000000
      })
    ]);
    expect(taxTotals(sections)).toEqual([
      section(sections, 'gstr3b-outward').rows[0].taxableValuePaise,
      section(sections, 'gstr3b-outward').rows[0].igstPaise,
      section(sections, 'gstr3b-outward').rows[0].cgstPaise,
      section(sections, 'gstr3b-outward').rows[0].sgstPaise
    ]);
  });

  it('returns all sections for an empty period and zero-valued 3B rows', () => {
    const sections = build();
    expect(sections.map(({ key }) => key)).toEqual([
      'gstr3b-outward',
      'gstr3b-interstate-unregistered',
      'gstr1-b2b',
      'gstr1-b2cl',
      'gstr1-b2cs',
      'gstr1-cdnr',
      'gstr1-cdnur',
      'gstr1-hsn',
      'gstr1-docs'
    ]);
    expect(section(sections, 'gstr3b-outward').rows[2]).toMatchObject({
      taxableValuePaise: 0,
      igstPaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      cessPaise: 0
    });
    for (const key of [
      'gstr3b-interstate-unregistered',
      'gstr1-b2b',
      'gstr1-b2cl',
      'gstr1-b2cs',
      'gstr1-cdnr',
      'gstr1-cdnur',
      'gstr1-hsn'
    ]) {
      expect(section(sections, key).rows).toEqual([]);
    }
    expect(section(sections, 'gstr1-docs').rows).toEqual([]);
  });
});
