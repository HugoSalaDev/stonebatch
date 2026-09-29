import { describe, expect, it, vi } from 'vitest';

import {
  LemonSqueezyAdapter,
  PaymentProviderUnavailableError,
} from '../src/lib/server/license/lemonsqueezy';
import { validateLicenseAccess } from '../src/lib/server/license/service';
import {
  TEST_ENV,
  jsonResponse,
  licensePayload,
  orderPayload,
} from './fixtures/license-validation';

describe('Lemon Squeezy adapter', () => {
  it('uses the License API contract, private Order API contract, and one shared deadline signal', async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input: String(input), init: init ?? {} });
      return calls.length === 1 ? jsonResponse(licensePayload()) : jsonResponse(orderPayload());
    }) as typeof fetch;

    const result = await validateLicenseAccess('CLIENT-SUPPLIED-KEY', TEST_ENV, {
      fetcher,
      now: () => new Date('2026-09-30T10:00:00.000Z'),
    });

    expect(result).toMatchObject({ httpStatus: 200, response: { code: 'ACTIVE' } });
    expect(calls).toHaveLength(2);
    expect(calls[0].input).toBe('https://api.lemonsqueezy.com/v1/licenses/validate');
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    expect(String(calls[0].init.body)).toBe('license_key=CLIENT-SUPPLIED-KEY');
    expect(String(calls[0].init.body)).not.toContain('instance_id');
    expect(calls[1].input).toBe('https://api.lemonsqueezy.com/v1/orders/505');
    expect(calls[1].init).toMatchObject({
      method: 'GET',
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${TEST_ENV.LEMONSQUEEZY_API_KEY}`,
      },
    });
    expect(calls[0].init.signal).toBe(calls[1].init.signal);
  });

  it('maps a License API 4xx to INVALID without requesting an order', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: 'not found' }, 404)) as typeof fetch;

    await expect(validateLicenseAccess('INVALID-KEY', TEST_ENV, { fetcher })).resolves.toEqual({
      httpStatus: 200,
      response: { allowed: false, expiresAt: null, code: 'INVALID' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['License API 5xx', [jsonResponse({ error: 'temporary' }, 500)]],
    ['Order API 4xx', [jsonResponse(licensePayload()), jsonResponse({ error: 'missing' }, 404)]],
    ['Order API 5xx', [jsonResponse(licensePayload()), jsonResponse({ error: 'temporary' }, 503)]],
  ])('fails closed when %s occurs', async (_label, responses) => {
    let index = 0;
    const fetcher = vi.fn(async () => responses[index++] ?? responses.at(-1)!) as typeof fetch;

    await expect(validateLicenseAccess('CLIENT-SUPPLIED-KEY', TEST_ENV, { fetcher })).resolves.toEqual({
      httpStatus: 503,
      response: { allowed: false, expiresAt: null, code: 'PAYMENT_UNAVAILABLE' },
    });
  });

  it('fails closed on malformed provider JSON', async () => {
    const fetcher = vi.fn(async () => new Response('{', { status: 200 })) as typeof fetch;

    await expect(validateLicenseAccess('CLIENT-SUPPLIED-KEY', TEST_ENV, { fetcher })).resolves.toMatchObject({
      httpStatus: 503,
      response: { code: 'PAYMENT_UNAVAILABLE' },
    });
  });

  it('aborts a hanging provider call at the single total deadline', async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    ) as typeof fetch;

    await expect(
      validateLicenseAccess('CLIENT-SUPPLIED-KEY', TEST_ENV, { fetcher, deadlineMs: 5 }),
    ).resolves.toEqual({
      httpStatus: 503,
      response: { allowed: false, expiresAt: null, code: 'PAYMENT_UNAVAILABLE' },
    });
  });

  it('clears the deadline after a completed operation', async () => {
    vi.useFakeTimers();
    const adapter = new LemonSqueezyAdapter({
      apiKey: 'synthetic-server-secret',
      fetcher: vi.fn(async () => jsonResponse(licensePayload())) as typeof fetch,
      deadlineMs: 10_000,
    });

    await expect(adapter.withinDeadline(async () => 'done')).resolves.toBe('done');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('normalizes unexpected adapter failures without exposing raw errors', async () => {
    const adapter = new LemonSqueezyAdapter({
      apiKey: 'synthetic-server-secret',
      fetcher: vi.fn(async () => {
        throw new Error('sensitive provider detail');
      }) as typeof fetch,
    });

    await expect(
      adapter.withinDeadline((session) => session.validateLicense('CLIENT-SUPPLIED-KEY')),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
  });
});
