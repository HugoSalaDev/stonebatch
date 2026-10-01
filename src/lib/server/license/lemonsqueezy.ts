export const LEMONSQUEEZY_API_ORIGIN = 'https://api.lemonsqueezy.com';
export const PROVIDER_DEADLINE_MS = 10_000;

export class PaymentProviderUnavailableError extends Error {
  public constructor() {
    super('Payment provider unavailable');
    this.name = 'PaymentProviderUnavailableError';
  }
}

export type LicenseProviderResult =
  | { kind: 'invalid' }
  | { kind: 'ok'; payload: unknown };

export interface LemonSqueezySession {
  validateLicense(licenseKey: string): Promise<LicenseProviderResult>;
  retrieveOrder(orderId: string): Promise<unknown>;
}

export interface LemonSqueezyAdapterOptions {
  apiKey: string;
  fetcher?: typeof fetch;
  deadlineMs?: number;
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PaymentProviderUnavailableError();
  }
}

export class LemonSqueezyAdapter {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly deadlineMs: number;

  public constructor(options: LemonSqueezyAdapterOptions) {
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.deadlineMs = options.deadlineMs ?? PROVIDER_DEADLINE_MS;
  }

  public async withinDeadline<T>(operation: (session: LemonSqueezySession) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.deadlineMs);

    const request = async (input: string, init: RequestInit): Promise<Response> => {
      try {
        return await this.fetcher(input, { ...init, signal: controller.signal });
      } catch {
        throw new PaymentProviderUnavailableError();
      }
    };

    const session: LemonSqueezySession = {
      validateLicense: async (licenseKey) => {
        const response = await request(`${LEMONSQUEEZY_API_ORIGIN}/v1/licenses/validate`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ license_key: licenseKey }),
        });

        if (response.status >= 400 && response.status < 500) {
          return { kind: 'invalid' };
        }

        if (!response.ok) {
          throw new PaymentProviderUnavailableError();
        }

        return { kind: 'ok', payload: await json(response) };
      },
      retrieveOrder: async (orderId) => {
        const response = await request(`${LEMONSQUEEZY_API_ORIGIN}/v1/orders/${orderId}`, {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.api+json',
            'Content-Type': 'application/vnd.api+json',
            Authorization: `Bearer ${this.apiKey}`,
          },
        });

        if (!response.ok) {
          throw new PaymentProviderUnavailableError();
        }

        return json(response);
      },
    };

    try {
      return await operation(session);
    } finally {
      clearTimeout(timeout);
    }
  }
}
