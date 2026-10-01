import type { LicenseConfig, LicenseRuntimeEnv } from '../../src/lib/server/license/types';

export const TEST_CONFIG: LicenseConfig = {
  apiKey: 'synthetic-server-secret',
  storeId: '101',
  productId: '202',
  variantId: '303',
  environment: 'test',
};

export const TEST_ENV: Required<LicenseRuntimeEnv> = {
  LEMONSQUEEZY_API_KEY: TEST_CONFIG.apiKey,
  LEMONSQUEEZY_STORE_ID: TEST_CONFIG.storeId,
  LEMONSQUEEZY_PRODUCT_ID: TEST_CONFIG.productId,
  LEMONSQUEEZY_VARIANT_ID: TEST_CONFIG.variantId,
  LEMONSQUEEZY_ENV: TEST_CONFIG.environment,
};

export const CREATED_AT = '2026-09-29T10:00:00.000Z';
export const EXPIRES_AT = '2026-10-06T10:00:00.000Z';

export function licensePayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    valid: true,
    error: null,
    license_key: {
      id: 404,
      status: 'inactive',
      key: 'SYNTHETIC-LICENSE-KEY',
      activation_limit: null,
      activation_usage: 0,
      created_at: CREATED_AT,
      expires_at: null,
    },
    instance: null,
    meta: {
      store_id: 101,
      order_id: 505,
      order_item_id: 606,
      product_id: 202,
      product_name: 'Synthetic product',
      variant_id: 303,
      variant_name: 'Synthetic variant',
      customer_id: 707,
      customer_name: 'Synthetic Customer',
      customer_email: 'synthetic@example.invalid',
    },
    ...overrides,
  };
}

export function orderPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    jsonapi: { version: '1.0' },
    data: {
      type: 'orders',
      id: '505',
      attributes: {
        store_id: 101,
        status: 'paid',
        refunded: false,
        refunded_amount: 0,
        created_at: CREATED_AT,
        test_mode: true,
        first_order_item: {
          id: 606,
          order_id: 505,
          product_id: 202,
          variant_id: 303,
          test_mode: true,
        },
        user_name: 'Synthetic Customer',
        user_email: 'synthetic@example.invalid',
        ...overrides,
      },
    },
  };
}

export function withMeta(payload: unknown, overrides: Record<string, unknown>): unknown {
  const source = payload as { meta: Record<string, unknown> };
  return { ...source, meta: { ...source.meta, ...overrides } };
}

export function withOrderData(
  payload: unknown,
  overrides: Record<string, unknown>,
): unknown {
  const source = payload as { data: Record<string, unknown> };
  return { ...source, data: { ...source.data, ...overrides } };
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
