import type { LicenseConfig, LicenseRuntimeEnv } from './types';

const NUMERIC_ID = /^[1-9]\d*$/;

function required(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function readLicenseConfig(env: LicenseRuntimeEnv): LicenseConfig | null {
  const apiKey = required(env.LEMONSQUEEZY_API_KEY);
  const storeId = required(env.LEMONSQUEEZY_STORE_ID);
  const productId = required(env.LEMONSQUEEZY_PRODUCT_ID);
  const variantId = required(env.LEMONSQUEEZY_VARIANT_ID);
  const environment = required(env.LEMONSQUEEZY_ENV);

  if (
    !apiKey ||
    !storeId ||
    !productId ||
    !variantId ||
    !NUMERIC_ID.test(storeId) ||
    !NUMERIC_ID.test(productId) ||
    !NUMERIC_ID.test(variantId) ||
    (environment !== 'test' && environment !== 'production')
  ) {
    return null;
  }

  return { apiKey, storeId, productId, variantId, environment };
}
