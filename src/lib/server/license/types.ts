export const ENTITLEMENT_CODES = [
  'ACTIVE',
  'INVALID',
  'WRONG_PRODUCT',
  'EXPIRED',
  'REFUNDED',
  'PAYMENT_UNAVAILABLE',
] as const;

export type EntitlementCode = (typeof ENTITLEMENT_CODES)[number];
export type LemonSqueezyEnvironment = 'test' | 'production';

export interface EntitlementResponse {
  allowed: boolean;
  expiresAt: string | null;
  code: EntitlementCode;
}

export interface LicenseConfig {
  apiKey: string;
  storeId: string;
  productId: string;
  variantId: string;
  environment: LemonSqueezyEnvironment;
}

export interface LicenseRuntimeEnv {
  LEMONSQUEEZY_API_KEY?: string;
  LEMONSQUEEZY_STORE_ID?: string;
  LEMONSQUEEZY_PRODUCT_ID?: string;
  LEMONSQUEEZY_VARIANT_ID?: string;
  LEMONSQUEEZY_ENV?: string;
}

export interface VerifiedLicenseMeta {
  orderId: string;
  orderItemId: string | null;
}

export interface ValidationOutcome {
  httpStatus: 200 | 503;
  response: EntitlementResponse;
}
