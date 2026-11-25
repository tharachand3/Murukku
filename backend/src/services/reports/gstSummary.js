import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import {
  defineReport,
  formatIstDate,
  makeSection,
  periodFilterShape,
  resolvePeriod
} from '../../lib/reportKit.js';
import { buildGstSections } from '../../lib/gstReport.js';
import { getSettings } from '../settingsService.js';

const filtersSchema = z.object({
  ...periodFilterShape.shape
}).strict();

const filterDocs = [
  { name: 'from', type: 'date', description: 'First inclusive IST calendar day' },
  { name: 'to', type: 'date', description: 'Last inclusive IST calendar day' }
];

function safeInteger(value, name) {
  const number = value ?? 0;
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return number;
}

function uqcFor(unitCode) {
  return ({
    packet: 'PAC',
    pcs: 'PCS',
    g: 'GMS',
    kg: 'KGS',
    ml: 'MLT',
    l: 'LTR'
  })[unitCode] ?? 'NOS';
}

function mapInvoice(invoice) {
  return {
    id: invoice.id,
    invoiceNo: invoice.invoiceNo,
    issueDate: formatIstDate(invoice.issueDate),
    status: invoice.status,
    isInterState: invoice.isInterState,
    placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
    totalPaise: safeInteger(invoice.totalPaise, 'Invoice total'),
    customer: {
      name: invoice.customer.name,
      gstin: invoice.customer.gstin
    },
    lines: invoice.lines.map((line) => ({
      hsnCode: line.hsnCode,
      description: line.description,
      uqc: uqcFor(line.item.baseUnit.code),
      qty: safeInteger(line.qty, 'Invoice line quantity'),
      gstRateBp: safeInteger(line.gstRateBp, 'GST rate'),
      taxableValuePaise: safeInteger(line.taxableValuePaise, 'Taxable value'),
      cgstPaise: safeInteger(line.cgstPaise, 'CGST'),
      sgstPaise: safeInteger(line.sgstPaise, 'SGST'),
      igstPaise: safeInteger(line.igstPaise, 'IGST'),
      totalPaise: safeInteger(line.totalPaise, 'Line total')
    }))
  };
}

const invoiceColumns = [
  { key: 'invoiceDate', label: 'Invoice date', type: 'date' },
  { key: 'invoiceNo', label: 'Invoice no.', type: 'text' },
  { key: 'invoiceValuePaise', label: 'Invoice value', type: 'money' },
  { key: 'placeOfSupply', label: 'Place of supply', type: 'text' },
  { key: 'reverseCharge', label: 'Reverse charge', type: 'text' },
  { key: 'invoiceType', label: 'Invoice type', type: 'text' },
  { key: 'ratePct', label: 'Rate (%)', type: 'decimal' },
  { key: 'taxableValuePaise', label: 'Taxable value', type: 'money' },
  { key: 'igstPaise', label: 'IGST', type: 'money' },
  { key: 'cgstPaise', label: 'CGST', type: 'money' },
  { key: 'sgstPaise', label: 'SGST', type: 'money' },
  { key: 'cessPaise', label: 'Cess', type: 'money' }
];

const outwardColumns = [
  { key: 'description', label: 'Description', type: 'text' },
  { key: 'taxableValuePaise', label: 'Taxable value', type: 'money' },
  { key: 'igstPaise', label: 'IGST', type: 'money' },
  { key: 'cgstPaise', label: 'CGST', type: 'money' },
  { key: 'sgstPaise', label: 'SGST', type: 'money' },
  { key: 'cessPaise', label: 'Cess', type: 'money' }
];

const interstateColumns = [
  { key: 'placeOfSupply', label: 'Place of supply', type: 'text' },
  { key: 'taxableValuePaise', label: 'Taxable value', type: 'money' },
  { key: 'igstPaise', label: 'IGST', type: 'money' }
];

const b2csColumns = [
  { key: 'supplyType', label: 'Supply type', type: 'text' },
  ...interstateColumns.slice(0, 1),
  { key: 'ratePct', label: 'Rate (%)', type: 'decimal' },
  { key: 'taxableValuePaise', label: 'Taxable value', type: 'money' },
  { key: 'igstPaise', label: 'IGST', type: 'money' },
  { key: 'cgstPaise', label: 'CGST', type: 'money' },
  { key: 'sgstPaise', label: 'SGST', type: 'money' },
  { key: 'cessPaise', label: 'Cess', type: 'money' }
];

const creditNoteColumns = [
  { key: 'noteNo', label: 'Credit note no.', type: 'text' },
  { key: 'noteDate', label: 'Credit note date', type: 'date' },
  { key: 'originalInvoiceNo', label: 'Original invoice no.', type: 'text' },
  { key: 'originalInvoiceDate', label: 'Original invoice date', type: 'date' },
  { key: 'noteValuePaise', label: 'Note value', type: 'money' },
  { key: 'placeOfSupply', label: 'Place of supply', type: 'text' },
  { key: 'ratePct', label: 'Rate (%)', type: 'decimal' },
  { key: 'taxableValuePaise', label: 'Taxable value', type: 'money' },
  { key: 'igstPaise', label: 'IGST', type: 'money' },
  { key: 'cgstPaise', label: 'CGST', type: 'money' },
  { key: 'sgstPaise', label: 'SGST', type: 'money' }
];

const sectionMetadata = {
  'gstr3b-outward': {
    title: 'GSTR-3B 3.1(a) - Outward taxable supplies',
    columns: outwardColumns
  },
  'gstr3b-interstate-unregistered': {
    title: 'GSTR-3B 3.2 - Inter-state supplies to unregistered persons',
    columns: interstateColumns
  },
  'gstr1-b2b': {
    title: 'GSTR-1 B2B - Registered recipients',
    columns: [
      { key: 'gstin', label: 'GSTIN', type: 'text' },
      { key: 'receiverName', label: 'Receiver name', type: 'text' },
      ...invoiceColumns
    ]
  },
  'gstr1-b2cl': {
    title: 'GSTR-1 B2CL - Large inter-state unregistered supplies',
    columns: [
      { key: 'receiverName', label: 'Receiver name', type: 'text' },
      ...invoiceColumns
    ]
  },
  'gstr1-b2cs': {
    title: 'GSTR-1 B2CS - Other unregistered supplies',
    columns: b2csColumns
  },
  'gstr1-cdnr': {
    title: 'GSTR-1 CDNR - Credit notes to registered recipients',
    columns: [
      { key: 'gstin', label: 'GSTIN', type: 'text' },
      { key: 'receiverName', label: 'Receiver name', type: 'text' },
      ...creditNoteColumns
    ]
  },
  'gstr1-cdnur': {
    title: 'GSTR-1 CDNUR - Credit notes to unregistered recipients',
    columns: creditNoteColumns
  },
  'gstr1-hsn': {
    title: 'GSTR-1 HSN summary',
    columns: [
      { key: 'hsnCode', label: 'HSN', type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'uqc', label: 'UQC', type: 'text' },
      { key: 'qty', label: 'Quantity', type: 'int' },
      { key: 'ratePct', label: 'Rate (%)', type: 'decimal' },
      { key: 'totalValuePaise', label: 'Total value', type: 'money' },
      { key: 'taxableValuePaise', label: 'Taxable value', type: 'money' },
      { key: 'igstPaise', label: 'IGST', type: 'money' },
      { key: 'cgstPaise', label: 'CGST', type: 'money' },
      { key: 'sgstPaise', label: 'SGST', type: 'money' }
    ]
  },
  'gstr1-docs': {
    title: 'GSTR-1 Documents issued',
    columns: [
      { key: 'description', label: 'Document type', type: 'text' },
      { key: 'fromSerial', label: 'From serial', type: 'text' },
      { key: 'toSerial', label: 'To serial', type: 'text' },
      { key: 'totalNumber', label: 'Total documents', type: 'int' },
      { key: 'cancelled', label: 'Cancelled', type: 'int' }
    ]
  }
};

const gstSummary = defineReport({
  key: 'gst-summary',
  title: 'GST Summary',
  description: 'GSTR-1 and GSTR-3B shaped sales and credit-note summaries for an IST period.',
  group: 'gst',
  capability: 'reports:read',
  filtersSchema,
  filterDocs,
  async run(db, filters) {
    const period = resolvePeriod(filters);
    const invoiceWhere = {
      issueDate: { gte: period.start, lt: period.endExclusive }
    };
    const creditNoteWhere = {
      createdAt: { gte: period.start, lt: period.endExclusive }
    };
    const [invoices, creditNotes, settings] = await Promise.all([
      db.invoice.findMany({
        where: invoiceWhere,
        orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
        take: 50001,
        select: {
          id: true,
          invoiceNo: true,
          issueDate: true,
          status: true,
          isInterState: true,
          placeOfSupplyStateCode: true,
          totalPaise: true,
          customer: { select: { name: true, gstin: true } },
          lines: {
            orderBy: { id: 'asc' },
            select: {
              hsnCode: true,
              description: true,
              qty: true,
              gstRateBp: true,
              taxableValuePaise: true,
              cgstPaise: true,
              sgstPaise: true,
              igstPaise: true,
              totalPaise: true,
              item: { select: { baseUnit: { select: { code: true } } } }
            }
          }
        }
      }),
      db.creditNote.findMany({
        where: creditNoteWhere,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 50001,
        select: {
          id: true,
          noteNo: true,
          createdAt: true,
          totalPaise: true,
          invoice: {
            select: {
              id: true,
              invoiceNo: true,
              issueDate: true,
              status: true,
              isInterState: true,
              placeOfSupplyStateCode: true,
              totalPaise: true,
              customer: { select: { name: true, gstin: true } },
              lines: {
                orderBy: { id: 'asc' },
                select: {
                  hsnCode: true,
                  description: true,
                  qty: true,
                  gstRateBp: true,
                  taxableValuePaise: true,
                  cgstPaise: true,
                  sgstPaise: true,
                  igstPaise: true,
                  totalPaise: true,
                  item: { select: { baseUnit: { select: { code: true } } } }
                }
              }
            }
          }
        }
      }),
      getSettings(db)
    ]);

    if (invoices.length > 50000 || creditNotes.length > 50000) {
      throw new AppError(422, 'TOO_MANY_ROWS', 'Report sections cannot exceed 50000 rows');
    }
    if (!settings.COMPANY_STATE_CODE) {
      throw new AppError(500, 'MISSING_SETTING', 'COMPANY_STATE_CODE is not configured');
    }

    const mappedInvoices = invoices.map(mapInvoice);
    const mappedCreditNotes = creditNotes.map((note) => ({
      noteNo: note.noteNo,
      noteDate: formatIstDate(note.createdAt),
      totalPaise: safeInteger(note.totalPaise, 'Credit note total'),
      invoice: mapInvoice(note.invoice)
    }));
    const sections = buildGstSections({
      invoices: mappedInvoices,
      creditNotes: mappedCreditNotes,
      sellerStateCode: settings.COMPANY_STATE_CODE
    });

    return {
      title: 'GST Summary',
      period: { from: period.fromDate, to: period.toDate },
      sections: sections.map((section) => {
        const metadata = sectionMetadata[section.key];
        if (section.rows.length > 50000) {
          throw new AppError(422, 'TOO_MANY_ROWS', 'Report sections cannot exceed 50000 rows');
        }
        return makeSection({
          key: section.key,
          title: metadata.title,
          columns: metadata.columns,
          rows: section.rows,
          totals: section.totals
        });
      })
    };
  }
});

export default gstSummary;
