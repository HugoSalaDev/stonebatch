import { describe, expect, it } from 'vitest';

import {
  evaluateOrder,
  inspectLicense,
} from '../src/lib/server/license/entitlement';
import type { LicenseConfig, VerifiedLicenseMeta } from '../src/lib/server/license/types';
import {
  CREATED_AT,
  EXPIRES_AT,
  TEST_CONFIG,
  licensePayload,
  orderPayload,
  withMeta,
  withOrderData,
} from './fixtures/license-validation';

const META: VerifiedLicenseMeta = { orderId: '505', orderItemId: '606' };

function attributes(payload: unknown): Record<string, unknown> {
  return (payload as { data: { attributes: Record<string, unknown> } }).data.attributes;
}

describe('license inspection', () => {
  it('accepts an inactive license when the provider says it is valid', () => {
    expect(inspectLicense(licensePayload(), TEST_CONFIG)).toEqual({
      kind: 'accepted',
      meta: META,
    });
  });

  it('rejects invalid, disabled, expired, and inconsistent licenses', () => {
    const cases = [
      licensePayload({ valid: false }),
      licensePayload({ license_key: { status: 'disabled', disabled: true } }),
      licensePayload({ license_key: { status: 'expired' } }),
      licensePayload({ meta: null }),
      withMeta(licensePayload(), { order_id: null }),
    ];

    for (const payload of cases) {
      expect(inspectLicense(payload, TEST_CONFIG)).toMatchObject({
        kind: 'denied',
        response: { allowed: false, expiresAt: null, code: 'INVALID' },
      });
    }
  });

  it.each([
    ['store_id', 999],
    ['product_id', 999],
    ['variant_id', 999],
  ])('rejects a wrong %s', (field, value) => {
    expect(inspectLicense(withMeta(licensePayload(), { [field]: value }), TEST_CONFIG)).toMatchObject({
      kind: 'denied',
      response: { code: 'WRONG_PRODUCT' },
    });
  });
});

describe('order entitlement evaluation', () => {
  it('allows a matching paid Test order inside the 168-hour window', () => {
    expect(evaluateOrder(orderPayload(), META, TEST_CONFIG, new Date('2026-10-01T00:00:00.000Z'))).toEqual({
      allowed: true,
      expiresAt: EXPIRES_AT,
      code: 'ACTIVE',
    });
  });

  it.each([
    ['pending'],
    ['failed'],
    ['fraudulent'],
  ])('denies a %s order without inventing a new public code', (status) => {
    expect(evaluateOrder(orderPayload({ status }), META, TEST_CONFIG, new Date(CREATED_AT))).toEqual({
      allowed: false,
      expiresAt: null,
      code: 'INVALID',
    });
  });

  it.each([
    ['refunded', { status: 'refunded' }],
    ['partial refund', { status: 'partial_refund' }],
    ['refunded flag', { refunded: true }],
    ['positive refunded amount', { refunded_amount: 1 }],
  ])('blocks %s', (_label, override) => {
    expect(evaluateOrder(orderPayload(override), META, TEST_CONFIG, new Date(CREATED_AT))).toEqual({
      allowed: false,
      expiresAt: null,
      code: 'REFUNDED',
    });
  });

  it('denies Test orders in Production and Production orders in Test', () => {
    const productionConfig: LicenseConfig = { ...TEST_CONFIG, environment: 'production' };
    expect(evaluateOrder(orderPayload(), META, productionConfig, new Date(CREATED_AT))).toMatchObject({
      code: 'WRONG_PRODUCT',
    });
    expect(
      evaluateOrder(orderPayload({ test_mode: false }), META, TEST_CONFIG, new Date(CREATED_AT)),
    ).toMatchObject({ code: 'WRONG_PRODUCT' });
  });

  it('checks the order, item, store, product, variant, and optional order item ID', () => {
    const base = orderPayload();
    const baseAttributes = attributes(base);
    const item = baseAttributes.first_order_item as Record<string, unknown>;
    const cases = [
      withOrderData(base, { id: '999' }),
      orderPayload({ store_id: 999 }),
      orderPayload({ first_order_item: { ...item, product_id: 999 } }),
      orderPayload({ first_order_item: { ...item, variant_id: 999 } }),
      orderPayload({ first_order_item: { ...item, id: 999 } }),
    ];

    for (const payload of cases) {
      expect(evaluateOrder(payload, META, TEST_CONFIG, new Date(CREATED_AT))).toMatchObject({
        code: 'WRONG_PRODUCT',
      });
    }
  });

  it.each([
    ['one millisecond before', '2026-10-06T09:59:59.999Z', 'ACTIVE'],
    ['exactly at the boundary', EXPIRES_AT, 'EXPIRED'],
    ['one millisecond after', '2026-10-06T10:00:00.001Z', 'EXPIRED'],
  ])('uses the exact server-time boundary: %s', (_label, now, code) => {
    expect(evaluateOrder(orderPayload(), META, TEST_CONFIG, new Date(now))).toMatchObject({
      code,
      expiresAt: EXPIRES_AT,
    });
  });

  it('fails closed on malformed provider order data', () => {
    expect(evaluateOrder({ data: null }, META, TEST_CONFIG, new Date(CREATED_AT))).toEqual({
      allowed: false,
      expiresAt: null,
      code: 'PAYMENT_UNAVAILABLE',
    });
  });
});
