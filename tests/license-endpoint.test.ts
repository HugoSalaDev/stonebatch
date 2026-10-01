import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRequest } from '../functions/api/license/validate';
import {
  TEST_ENV,
  jsonResponse,
  licensePayload,
  orderPayload,
} from './fixtures/license-validation';

function request(body: unknown, headers: HeadersInit = {}): Request {
  return new Request('https://preview.example/api/license/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/license/validate', () => {
  it('accepts only POST', async () => {
    const response = await onRequest({
      request: new Request('https://preview.example/api/license/validate'),
      env: TEST_ENV,
    });

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it.each([
    ['non-JSON body', request('license', { 'Content-Type': 'text/plain' })],
    ['malformed JSON', request('{')],
    ['non-object JSON', request([])],
    ['missing key', request({})],
    ['empty key', request({ licenseKey: '   ' })],
    ['overlong key', request({ licenseKey: 'x'.repeat(201) })],
    ['extra field', request({ licenseKey: 'key', orderId: 505 })],
    ['client product ID', request({ licenseKey: 'key', productId: 202 })],
    ['client success flag', request({ licenseKey: 'key', success: true })],
  ])('returns 400 for %s', async (_label, input) => {
    const response = await onRequest({ request: input, env: TEST_ENV });
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ allowed: false, expiresAt: null, code: 'INVALID' });
  });

  it('rejects a body larger than 1 KB', async () => {
    const response = await onRequest({
      request: request({ licenseKey: 'key', padding: 'x'.repeat(1_024) }),
      env: TEST_ENV,
    });
    expect(response.status).toBe(400);
  });

  it('fails closed when any required server variable is absent', async () => {
    const { LEMONSQUEEZY_API_KEY: _removed, ...incompleteEnv } = TEST_ENV;
    const response = await onRequest({
      request: request({ licenseKey: 'CLIENT-SUPPLIED-KEY' }),
      env: incompleteEnv,
    });

    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({
      allowed: false,
      expiresAt: null,
      code: 'PAYMENT_UNAVAILABLE',
    });
  });

  it('returns only the public entitlement fields and never provider customer or key data', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (call++ === 0 ? jsonResponse(licensePayload()) : jsonResponse(orderPayload()))),
    );

    const suppliedKey = 'CLIENT-SUPPLIED-KEY';
    const response = await onRequest({
      request: request({ licenseKey: suppliedKey }),
      env: TEST_ENV,
    });
    const payload = await body(response);
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(Object.keys(payload).sort()).toEqual(['allowed', 'code', 'expiresAt']);
    expect(payload.code).toBe('ACTIVE');
    expect(serialized).not.toContain('customer');
    expect(serialized).not.toContain('synthetic@example.invalid');
    expect(serialized).not.toContain(suppliedKey);
    expect(serialized).not.toContain(TEST_ENV.LEMONSQUEEZY_API_KEY);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns a controlled 503 for provider network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network unavailable');
      }),
    );

    const response = await onRequest({
      request: request({ licenseKey: 'CLIENT-SUPPLIED-KEY' }),
      env: TEST_ENV,
    });
    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({
      allowed: false,
      expiresAt: null,
      code: 'PAYMENT_UNAVAILABLE',
    });
  });
});
