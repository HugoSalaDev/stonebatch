# License validation operations

## Endpoint

`POST /api/license/validate` accepts exactly one JSON property:

```json
{ "licenseKey": "customer-provided-key" }
```

The key must be a non-empty string of at most 200 characters. The endpoint
rejects non-JSON bodies, additional properties, client-supplied order/product
IDs, and bodies larger than 1 KB with HTTP `400`.

Every JSON response contains exactly:

```json
{ "allowed": false, "expiresAt": null, "code": "INVALID" }
```

`expiresAt` is an ISO-8601 server timestamp for `ACTIVE` and `EXPIRED`, and is
otherwise `null`. Responses never include the licence key, buyer data, provider
payloads, order IDs, or configured commerce IDs.

## Codes

| Code | Meaning | HTTP |
| --- | --- | --- |
| `ACTIVE` | Matching paid order inside its access window | 200 |
| `INVALID` | Invalid/disabled/expired licence, or an unpaid/failed/fraudulent order | 200 |
| `WRONG_PRODUCT` | Store, product, variant, order linkage, or Test/Production environment mismatch | 200 |
| `EXPIRED` | Server time is at or after the 168-hour boundary | 200 |
| `REFUNDED` | Full or partial refund signal is present | 200 |
| `PAYMENT_UNAVAILABLE` | Missing server configuration, timeout, network failure, provider failure, or malformed order data | 503 |

The refund check blocks `refunded`, `partial_refund`, `refunded === true`, and
any positive `refunded_amount`.

## Server-only configuration

The Pages Function requires these bindings:

- `LEMONSQUEEZY_API_KEY`
- `LEMONSQUEEZY_STORE_ID`
- `LEMONSQUEEZY_PRODUCT_ID`
- `LEMONSQUEEZY_VARIANT_ID`
- `LEMONSQUEEZY_ENV`

`LEMONSQUEEZY_ENV` must be exactly `test` or `production`. No value has a
default. Missing or invalid configuration fails closed with
`PAYMENT_UNAVAILABLE`.

For T11, configure the Test Mode API key and Test IDs only in Cloudflare's
Preview environment. Production deliberately remains without Lemon Squeezy
bindings until Live credentials exist, so a production request fails closed.
Never prefix these names with `PUBLIC_` or add their values to `.env.example`,
`.dev.vars.example`, Wrangler configuration, source code, or client bundles.

## Provider checks and access window

The function validates the key without activating an instance, compares
licence metadata against server configuration, then retrieves the associated
order through the authenticated private API. The order must be `paid`, match
the same IDs and environment, and have no refund signal.

The access boundary is calculated only from the order:

```text
expiresAt = order.created_at + 168 hours
serverNow < expiresAt  => ACTIVE
serverNow >= expiresAt => EXPIRED
```

The two provider calls share one `AbortController` and one 10-second timer.
They do not receive independent 10-second budgets.

## Reproducing the Preview smoke test

1. Confirm the target deployment is a Cloudflare Preview deployment and its
   server bindings contain only Test Mode values.
2. Copy the existing Test licence from the Lemon Squeezy dashboard into a
   temporary, non-persisted shell variable. Do not paste it into a command,
   file, fixture, terminal transcript, or documentation.
3. Send `POST /api/license/validate` with the request shape above and confirm
   HTTP `200`, `allowed: true`, and `code: ACTIVE`.
4. Unset the temporary variable immediately.
5. Repeat with a random synthetic invalid key and confirm `code: INVALID`.

Do not test the Test licence against Production. Production stays fail-closed
until separate Live credentials and IDs are intentionally configured in a
later task.
