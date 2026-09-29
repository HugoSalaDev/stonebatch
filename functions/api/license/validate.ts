import { entitlementResponse } from '../../../src/lib/server/license/entitlement';
import { validateLicenseAccess } from '../../../src/lib/server/license/service';
import type {
  EntitlementResponse,
  LicenseRuntimeEnv,
} from '../../../src/lib/server/license/types';

const MAX_BODY_BYTES = 1_024;
const MAX_LICENSE_KEY_CHARACTERS = 200;

interface PagesContext {
  request: Request;
  env: LicenseRuntimeEnv;
}

function response(body: EntitlementResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

async function parseLicenseKey(request: Request): Promise<string | null> {
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return null;
  }

  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return null;
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return null;
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.licenseKey !== 'string') {
    return null;
  }

  const licenseKey = record.licenseKey.trim();
  if (!licenseKey || licenseKey.length > MAX_LICENSE_KEY_CHARACTERS) {
    return null;
  }

  return licenseKey;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: 'POST',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  const licenseKey = await parseLicenseKey(context.request);
  if (!licenseKey) {
    return response(entitlementResponse('INVALID'), 400);
  }

  const result = await validateLicenseAccess(licenseKey, context.env);
  return response(result.response, result.httpStatus);
}
