import { describe, expect, it } from 'vitest';
import {
  canLoadReportLookup,
  reportFilterDefault,
  reportEnumLabel,
  reportFilterLabel,
  reportLookupOptionLabel,
  reportFilterUi,
  reportLookupItemTypes
} from './reportFilterUi.js';

describe('report filter UI mapping', () => {
  it('maps backend enums to the report-specific option sets', () => {
    expect(reportFilterUi('sales-register', { name: 'status' })).toEqual({
      kind: 'enum',
      values: ['ALL', 'POSTED', 'CANCELLED']
    });
    expect(reportFilterUi('production-report', { name: 'status' }).values)
      .toEqual(['ALL', 'COMPLETED', 'ISSUED', 'CANCELLED']);
    expect(reportFilterUi('sales-register', { name: 'taxType' }).values)
      .toEqual(['ALL', 'INTRA', 'INTER']);
    expect(reportFilterUi('sales-by-customer', { name: 'customerType' }).values)
      .toEqual(['RETAILER', 'DISTRIBUTOR']);
    expect(reportFilterUi('purchase-register', { name: 'type' }).values)
      .toEqual(['RAW', 'PACKAGING']);
    expect(reportFilterUi('stock-summary', { name: 'type' }).values)
      .toEqual(['RAW', 'PACKAGING', 'FINISHED']);
  });

  it('maps periods, boolean filters, and unknown filters to the expected controls', () => {
    expect(reportFilterUi('sales-register', { name: 'from' }).kind).toBe('period');
    expect(reportFilterUi('receivables-ageing', { name: 'asOf', type: 'date' }).kind)
      .toBe('date');
    expect(reportFilterUi('receivables-ageing', { name: 'detail', type: 'boolean' }).kind)
      .toBe('checkbox');
    expect(reportFilterUi('stock-summary', { name: 'hideEmpty' }).kind).toBe('checkbox');
    expect(reportFilterUi('sales-register', { name: 'searchTerm', type: 'text' }).kind)
      .toBe('text');
    expect(reportFilterUi('sales-register', { name: 'limit' }).kind).toBe('limit');
  });

  it('uses lookup endpoints only for roles allowed to load their options', () => {
    expect(reportFilterUi('sales-register', { name: 'customerId' })).toMatchObject({
      kind: 'lookup',
      endpoint: '/customers'
    });
    expect(reportFilterUi('purchase-register', { name: 'supplierId' }).endpoint)
      .toBe('/suppliers');
    expect(canLoadReportLookup('ACCOUNTANT', 'customerId')).toBe(true);
    expect(canLoadReportLookup('SALESMAN', 'customerId')).toBe(false);
    expect(canLoadReportLookup('ADMIN', 'unknownId')).toBe(false);
    expect(reportLookupItemTypes('sales-by-product', 'itemId')).toEqual(['FINISHED']);
    expect(reportLookupItemTypes('purchase-register', 'itemId')).toEqual(['RAW', 'PACKAGING']);
    expect(reportLookupItemTypes('stock-summary', 'itemId')).toBeNull();
    expect(reportFilterLabel({ name: 'finishedItemId' })).toBe('Finished item');
    expect(reportLookupOptionLabel('customerId', { id: 7, name: 'Retailer A' }))
      .toBe('Retailer A');
    expect(reportLookupOptionLabel('itemId', { id: 2, code: 'FLOUR', name: 'Flour' }))
      .toBe('FLOUR — Flour');
    expect(reportEnumLabel('ALL')).toBe('All');
    expect(reportEnumLabel('RETAILER')).toBe('Retailer');
    expect(reportFilterDefault('sales-register', 'status')).toBe('ALL');
    expect(reportFilterDefault('production-report', 'status')).toBe('COMPLETED');
    expect(reportFilterDefault('stock-summary', 'hideEmpty')).toBe('false');
    expect(reportFilterDefault('receivables-ageing', 'asOf', '2026-11-26'))
      .toBe('2026-11-26');
  });
});
