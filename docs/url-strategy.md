# URL Strategy

Stacksmith should make integration URLs explicit. Generated apps should not infer OAuth callbacks, email link bases, Stripe webhook URLs, API URLs, or file URLs ad hoc.

## Required Runtime Contract

Every environment gets:

```text
APP_URL
API_URL
FILES_URL
AUTH_CALLBACK_URL
EMAIL_LINK_BASE_URL
STRIPE_WEBHOOK_URL
```

The application must use these values for navigation, auth, email links, webhooks, uploads, CORS, and observability.

## Provider Ownership

The default Stacksmith stack uses Vercel for web deployments, Prisma Postgres through the Vercel Marketplace for the database, and Cloudflare for URL-level infrastructure:

```text
app/staging/preview URLs -> Vercel
api URLs                 -> Google Cloud Run
files URLs               -> Cloudflare R2 custom domains
dev tunnel URLs          -> Cloudflare Tunnel
DNS/domain records       -> Cloudflare
```

That split keeps Vercel focused on the Next.js app while Cloudflare owns the stable hostnames needed for uploads, phone testing, social OAuth callbacks, and future domain promotion.

## Managed Domain Mode

Managed mode is the fully seamless mode:

```text
dev.project.com
api.dev.project.com
files.dev.project.com
staging.project.com
api.staging.project.com
files.staging.project.com
project.com
api.project.com
files.project.com
```

This supports stable social OAuth callbacks, email links, file uploads, phone testing, and webhooks.

## Project Subdomain Mode

Subdomain mode uses a root domain you already own:

```yaml
domain:
  mode: subdomain
  baseDomain: finternet.com
  projectSubdomain: push
```

Stacksmith derives:

```text
push.finternet.com
staging.push.finternet.com
dev.push.finternet.com
api.push.finternet.com
api.staging.push.finternet.com
api.dev.push.finternet.com
files.push.finternet.com
files.staging.push.finternet.com
files.dev.push.finternet.com
mail.push.finternet.com
```

This is the preferred default when you want stable social OAuth and phone testing without buying a new domain per project.

## Free URL Mode

Free mode can be seamless for basic app use, email OTP, magic links, file uploads, and phone testing with quick tunnels. It is not fully seamless for social OAuth unless provider callback URLs can be updated or the project uses a stable auth proxy.

Quick tunnel URLs are ephemeral:

```text
cloudflared tunnel --url http://localhost:3000
cloudflared tunnel --url http://localhost:4000
```

Stacksmith should write those session URLs into `.env.local` before starting the app.

## Social OAuth

Social providers generally require allowlisted callback URLs. For social OAuth to work in development, preview, staging, and production without manual callback edits, use one of:

- managed project domain with stable environment callback URLs;
- a Stacksmith-controlled stable auth proxy;
- provider app automation that updates callback URLs for ephemeral dev tunnels.

The preferred default is managed project domain plus stable named tunnel for development.
