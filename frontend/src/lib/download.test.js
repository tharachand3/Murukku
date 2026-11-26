import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { installApiInterceptors } from './apiSetup.js';
import { downloadAuthenticatedFile } from './download.js';
import { saveSession } from './session.js';
import { createMockAdapter } from '../test/mockAdapter.js';

describe('downloadAuthenticatedFile', () => {
  let createObjectURL;
  let revokeObjectURL;

  beforeEach(() => {
    saveSession({ token: 'download-token', user: { id: 1, role: 'ADMIN' } });
    installApiInterceptors(api, {
      getToken: () => 'download-token',
      onUnauthorized: () => {}
    });
    createObjectURL = URL.createObjectURL;
    revokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:download');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.restoreAllMocks();
  });

  it('sends an authenticated blob request and downloads the server filename', async () => {
    const blob = new Blob(['file contents']);
    const adapter = createMockAdapter({
      'GET /reports/stock-ledger/export': {
        status: 200,
        data: blob,
        headers: { 'content-disposition': 'attachment; filename="stock_ledger.csv"' }
      }
    });
    api.defaults.adapter = adapter;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await expect(downloadAuthenticatedFile(
      '/reports/stock-ledger/export',
      { format: 'csv', itemId: 7 },
      'ledger.csv'
    )).resolves.toBe('stock_ledger.csv');

    expect(adapter.calls[0].headers.Authorization).toBe('Bearer download-token');
    expect(adapter.calls[0].params).toEqual({ format: 'csv', itemId: 7 });
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  it('uses the default filename when the server omits Content-Disposition', async () => {
    const adapter = createMockAdapter({
      'GET /download': { status: 200, data: new Blob(['file']) }
    });
    api.defaults.adapter = adapter;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(downloadAuthenticatedFile('/download', {}, 'fallback.pdf'))
      .resolves.toBe('fallback.pdf');
  });
});
