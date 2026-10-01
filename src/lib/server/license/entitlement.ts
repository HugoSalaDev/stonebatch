import type {
  EntitlementCode,
  EntitlementResponse,
  LicenseConfig,
  VerifiedLicenseMeta,
} from './types';

export const ACCESS_DURATION_MS = 168 * 60 * 60 * 1_000;

type JsonRecord = Record<string, unknown>;

export type LicenseInspection =
  | { kind: 'accepted'; meta: VerifiedLicenseMeta }
  | { kind: 'denied'; response: EntitlementResponse };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function id(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    return value;
  }

  return null;
}

export function entitlementResponse(
  code: EntitlementCode,
  expiresAt: string | null = null,
): EntitlementResponse {
  return {
    allowed: code === 'ACTIVE',
    expiresAt,
    code,
  };
}

export function inspectLicense(payload: unknown, config: LicenseConfig): LicenseInspection {
  if (!isRecord(payload) || payload.valid !== true) {
    return { kind: 'denied', response: entitlementResponse('INVALID') };
  }

  const licenseKey = payload.license_key;
  const meta = payload.meta;

  if (!isRecord(licenseKey) || !isRecord(meta)) {
    return { kind: 'denied', response: entitlementResponse('INVALID') };
  }

  const status = licenseKey.status;
  if (
    licenseKey.disabled === true ||
    (status !== 'active' && status !== 'inactive')
  ) {
    return { kind: 'denied', response: entitlementResponse('INVALID') };
  }

  const storeId = id(meta.store_id);
  const productId = id(meta.product_id);
  const variantId = id(meta.variant_id);
  const orderId = id(meta.order_id);
  const orderItemId = meta.order_item_id === undefined ? null : id(meta.order_item_id);

  if (!storeId || !productId || !variantId || !orderId || (meta.order_item_id !== undefined && !orderItemId)) {
    return { kind: 'denied', response: entitlementResponse('INVALID') };
  }

  if (
    storeId !== config.storeId ||
    productId !== config.productId ||
    variantId !== config.variantId
  ) {
    return { kind: 'denied', response: entitlementResponse('WRONG_PRODUCT') };
  }

  return { kind: 'accepted', meta: { orderId, orderItemId } };
}

export function evaluateOrder(
  payload: unknown,
  licenseMeta: VerifiedLicenseMeta,
  config: LicenseConfig,
  serverNow: Date,
): EntitlementResponse {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return entitlementResponse('PAYMENT_UNAVAILABLE');
  }

  const data = payload.data;
  if (data.type !== 'orders' || id(data.id) !== licenseMeta.orderId || !isRecord(data.attributes)) {
    return entitlementResponse('WRONG_PRODUCT');
  }

  const attributes = data.attributes;
  const orderStoreId = id(attributes.store_id);
  const item = attributes.first_order_item;

  if (!orderStoreId || !isRecord(item)) {
    return entitlementResponse('PAYMENT_UNAVAILABLE');
  }

  if (
    orderStoreId !== config.storeId ||
    id(item.product_id) !== config.productId ||
    id(item.variant_id) !== config.variantId ||
    (item.order_id !== undefined && id(item.order_id) !== licenseMeta.orderId) ||
    (licenseMeta.orderItemId !== null && id(item.id) !== licenseMeta.orderItemId)
  ) {
    return entitlementResponse('WRONG_PRODUCT');
  }

  const expectedTestMode = config.environment === 'test';
  if (attributes.test_mode !== expectedTestMode) {
    return entitlementResponse('WRONG_PRODUCT');
  }

  const status = attributes.status;
  const refunded = attributes.refunded;
  const refundedAmount = attributes.refunded_amount;

  if (
    typeof status !== 'string' ||
    typeof refunded !== 'boolean' ||
    typeof refundedAmount !== 'number' ||
    !Number.isFinite(refundedAmount)
  ) {
    return entitlementResponse('PAYMENT_UNAVAILABLE');
  }

  if (
    status === 'refunded' ||
    status === 'partial_refund' ||
    refunded ||
    refundedAmount > 0
  ) {
    return entitlementResponse('REFUNDED');
  }

  if (status !== 'paid') {
    return entitlementResponse('INVALID');
  }

  if (typeof attributes.created_at !== 'string') {
    return entitlementResponse('PAYMENT_UNAVAILABLE');
  }

  const createdAtMs = Date.parse(attributes.created_at);
  const nowMs = serverNow.getTime();
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) {
    return entitlementResponse('PAYMENT_UNAVAILABLE');
  }

  const expiresAtMs = createdAtMs + ACCESS_DURATION_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();

  return nowMs < expiresAtMs
    ? entitlementResponse('ACTIVE', expiresAt)
    : entitlementResponse('EXPIRED', expiresAt);
}
