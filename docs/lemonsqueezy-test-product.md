# Lemon Squeezy Test Mode product

## Scope

This record applies **only** to Lemon Squeezy Test Mode. Live Mode has not been
enabled, the store has not been activated for live sales, and no API key,
customer data, payment data, or usable licence key is recorded here.

## Product configuration

| Setting | TEST configuration |
| --- | --- |
| Product | `StoneBatch — 7-day batch export pass` |
| Product ID | `1397629` (TEST) |
| Payment type | Single payment / standard pricing |
| Price | EUR 9.90 |
| Quantity | 1 in the Test checkout |
| Tax | Store-level **Tax-inclusive pricing** enabled; product category: Software as a service (SaaS) - personal use |
| Subscription, renewal and PWYW | Not enabled |
| Initial discounts and upsells | Not configured |
| Public Test checkout ID | `2341ddd8-f34d-4d1d-a7e7-719e9f47c6f6` |

The current Test Mode product editor does not expose a separate default variant
identifier for this simple single-payment product. No API key was created just
to retrieve one. Record a TEST variant ID only if Lemon Squeezy exposes one
before an API-based task needs it.

The current Test Mode UI also does not display a numeric store ID. It must be
recorded only from an authorised integration surface; do not infer or fabricate
it from the storefront slug.

The public checkout copy is:

> 7-day batch export access. One-time payment. No subscription or automatic
> renewal. 14-day self-service refund policy. Export up to 30 valid designs
> per batch.

## Licence configuration

`Generate license keys` is enabled. Both `Set length to unlimited` and `Set
limit to unlimited` are enabled. Consequently Lemon Squeezy does not impose a
licence expiry or device activation limit. StoneBatch will apply the 168-hour
access window itself from the real order time in T11; T10 does not call the
License API or simulate an activation.

## Confirmation modal and email receipt

Both CTAs use the label `Activate StoneBatch` and currently point to:

`https://stonebatch.pages.dev/activate/`

The requested fragment form
`https://stonebatch.pages.dev/activate/#license_key=[license_key]` was rejected
by the current Lemon Squeezy editor as an invalid URL for both CTA fields. It
was therefore not published and no query-string fallback was used. The
confirmation CTA was exercised after a Test Mode order and navigated to the
exact fallback URL above, with neither a fragment nor a query string.

T12 fallback: present a manual licence-key entry field on `/activate/`; the
buyer can copy the key shown in the Lemon Squeezy receipt. Do not put a licence
key in a query string.

## Test purchase evidence

One Test Mode checkout was completed using Lemon Squeezy's official test-card
flow and fictitious buyer details. The order is recorded as paid, is a one-time
purchase, and generated exactly one licence. The order record reports that the
licence never expires and is inactive, consistent with the intended unlimited
licence configuration. No full licence key, purchaser information, or payment
details are stored in this repository.

The configured receipt CTA was reviewed in the product editor. The Test Mode
receipt is sent by Lemon Squeezy to the store owner/team; this environment has
no connected mailbox from which to open that email, so the rendered email CTA
and its licence display remain a manual Test Mode verification item. The
configuration and the confirmation CTA fallback have been verified.

## Terms and refunds

The checkout exposes Lemon Squeezy buyer terms, privacy, and help links. There
is no StoneBatch-specific terms URL yet, so no fictitious link was configured.
That legal page is pending T16. The product copy includes the required
14-day self-service refund-policy statement; T10 does not implement refunds.

## Reproducing this later in Live Mode

Only after the store is legitimately activated for Live Mode, recreate the
product manually in Live Mode and verify every value above. Never reuse this
TEST product ID, checkout ID, any Test Mode licence, or any Test Mode order
data. Live IDs and checkout links will be distinct and must be recorded
separately after their own controlled verification.

Useful official references:

- https://docs.lemonsqueezy.com/help/getting-started/test-mode/
- https://docs.lemonsqueezy.com/help/licensing/license-api
- https://docs.lemonsqueezy.com/help/products/pricing-models
