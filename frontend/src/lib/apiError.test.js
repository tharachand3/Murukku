import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import { fieldErrors, toApiError } from './apiError.js';

describe('API errors', () => {
  it('passes backend envelopes through and identifies unauthorized responses', () => {
    expect(toApiError({
      response: {
        status: 422,
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            details: [{ path: 'body.lines.0.qty', message: 'Must be positive' }]
          }
        }
      }
    })).toEqual({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      details: [{ path: 'body.lines.0.qty', message: 'Must be positive' }],
      isNetwork: false,
      isUnauthorized: false
    });
    expect(toApiError({ response: { status: 401, data: { error: {} } } }).isUnauthorized).toBe(true);
  });

  it('returns a network message only for response-less Axios errors', () => {
    expect(toApiError(new AxiosError('Network Error', AxiosError.ERR_NETWORK))).toMatchObject({
      code: 'NETWORK',
      message: 'Cannot reach the server. Check your connection.',
      isNetwork: true,
      isUnauthorized: false
    });
    expect(toApiError(new Error('Unexpected'))).toMatchObject({
      code: 'UNKNOWN',
      message: 'Unexpected',
      isNetwork: false
    });
  });

  it('maps backend issue paths to field messages', () => {
    expect(fieldErrors([
      { path: 'body.lines.0.qty', message: 'Enter a positive quantity' },
      { path: 'customerId', message: 'Required' }
    ])).toEqual({
      'lines.0.qty': 'Enter a positive quantity',
      customerId: 'Required'
    });
    expect(fieldErrors(null)).toEqual({});
  });
});
