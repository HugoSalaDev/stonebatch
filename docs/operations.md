# StoneBatch operations

## Prerequisites

- Node.js 24.x (the validated range is declared in `package.json`).
- A free Cloudflare account for a Pages project. Do not enable Workers Paid or add billing.

## Install

The following installation commands were executed successfully for T01:

```sh
npm install
```

For a clean, lockfile-based installation:

```sh
npm ci
```

## Run locally

Use this command in a normal local development environment:

```sh
npm run dev
```

The static build can be served locally with:

```sh
npm run preview
```

To exercise the Cloudflare Pages runtime locally over HTTPS (self-signed certificate):

```sh
npm run build
npm run pages:dev
```

This sandbox cannot expose a local network listener, so the HTTPS server command was not completed
here. It is the official Wrangler Pages command configured by this project.

## Build

The validated build command was:

```sh
ASTRO_TELEMETRY_DISABLED=1 npm run build
```

`ASTRO_TELEMETRY_DISABLED=1` is only necessary in restricted environments where Astro cannot write
its optional telemetry configuration. In a normal local environment, `npm run build` is sufficient.

The deployable static output is written to `dist/`.

## First Cloudflare Pages preview deployment

Authenticate Wrangler with the authorized Cloudflare account, then deploy the built output to the
free Pages project. The project name must be `stonebatch`.

```sh
npx wrangler login
npm run build
npx wrangler pages deploy dist --project-name stonebatch --branch preview
```

Cloudflare returns the exact HTTPS `*.pages.dev` preview URL after deployment. Keep the `preview`
branch deployment as a noindex environment; this T01 build includes both a robots meta tag and the
Cloudflare Pages `_headers` `X-Robots-Tag` header.

## T01 deployment record

The initial free Pages project was created manually in the Cloudflare Pages dashboard by the
account holder, rather than through the Wrangler direct-upload command above. The active URLs are:

- `https://stonebatch.pages.dev`
- `https://2f926fa8.stonebatch.pages.dev`

Both URLs were verified on 28 September 2026 with HTTPS `200`, the HTML `noindex, nofollow` meta
tag, the `X-Robots-Tag: noindex, nofollow` response header, and `/robots.txt` disallowing crawling.
The Wrangler commands remain the documented direct-upload procedure for a future explicitly
authorized deployment.

## Production deployment (not part of T01)

Do not run a production deployment as part of T01. When a later task explicitly authorizes it,
build and deploy the `main` branch with Cloudflare Pages. Review and remove the preview-wide
`noindex` controls only when the product is ready to be indexed.
