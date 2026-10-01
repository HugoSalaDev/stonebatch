import { readLicenseConfig } from './config';
import { entitlementResponse, evaluateOrder, inspectLicense } from './entitlement';
import {
  LemonSqueezyAdapter,
  PaymentProviderUnavailableError,
} from './lemonsqueezy';
import type { LicenseRuntimeEnv, ValidationOutcome } from './types';

export interface LicenseValidationDependencies {
  fetcher?: typeof fetch;
  now?: () => Date;
  deadlineMs?: number;
}

function outcome(response: ValidationOutcome['response']): ValidationOutcome {
  return {
    httpStatus: response.code === 'PAYMENT_UNAVAILABLE' ? 503 : 200,
    response,
  };
}

export async function validateLicenseAccess(
  licenseKey: string,
  env: LicenseRuntimeEnv,
  dependencies: LicenseValidationDependencies = {},
): Promise<ValidationOutcome> {
  const config = readLicenseConfig(env);
  if (!config) {
    return outcome(entitlementResponse('PAYMENT_UNAVAILABLE'));
  }

  const adapter = new LemonSqueezyAdapter({
    apiKey: config.apiKey,
    fetcher: dependencies.fetcher,
    deadlineMs: dependencies.deadlineMs,
  });

  try {
    return await adapter.withinDeadline(async (session) => {
      const license = await session.validateLicense(licenseKey);
      if (license.kind === 'invalid') {
        return outcome(entitlementResponse('INVALID'));
      }

      const inspection = inspectLicense(license.payload, config);
      if (inspection.kind === 'denied') {
        return outcome(inspection.response);
      }

      const order = await session.retrieveOrder(inspection.meta.orderId);
      return outcome(evaluateOrder(order, inspection.meta, config, (dependencies.now ?? (() => new Date()))()));
    });
  } catch (error) {
    if (error instanceof PaymentProviderUnavailableError) {
      return outcome(entitlementResponse('PAYMENT_UNAVAILABLE'));
    }

    return outcome(entitlementResponse('PAYMENT_UNAVAILABLE'));
  }
}
