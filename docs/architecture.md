# Architecture

Stacksmith has three layers.

## CLI and Agent Surface

The CLI is the human interface. The MCP tool registry is the future agent interface. Both should call the same core orchestration APIs instead of duplicating provider logic.

## Control Plane

The control plane owns:

- project manifests;
- generated state;
- provider orchestration;
- health checks;
- incidents;
- actions;
- audit records;
- preview metadata.

The manifest describes desired state. The state file records provider identifiers and local scaffold status. Secrets are not stored in state.

## Provider Adapters

Provider adapters implement:

```ts
inspect(manifest, state)
plan(manifest, state)
apply(manifest, state, changes)
health(manifest, state)
```

Current adapters are scaffolds. They model desired resources and local state without calling vendor APIs.

The default provider choices are intentionally opinionated:

- Vercel owns the web app and deployment environment variables.
- Prisma Postgres is provisioned through the Vercel Marketplace and consumed through Prisma ORM.
- Cloudflare owns file storage, DNS, domain registration, and development tunnels.
- Cloudflare also owns R2 event ingestion through bucket notifications, Queues, and a forwarding Worker.
- Google Cloud Run owns background jobs and long-running work.
- PostHog owns analytics, error tracking, logs, replay, and feature flags through a shared-incubator project by default.
- Slack owns per-project activity and alert channels, including interactive incident actions.

The generated application still depends on normalized URLs and environment variables, not provider-specific assumptions.

## Generated Apps

Generated apps should receive a normalized deployment contract:

```text
APP_ENV
APP_URL
API_URL
FILES_URL
PREVIEW_ID
GITHUB_PR_NUMBER
GIT_BRANCH
GIT_SHA
DATABASE_URL
DIRECT_DATABASE_URL
```

Application code should use this contract for auth callbacks, email links, Stripe redirects, CORS, file URLs, and observability tags.

Generated apps should use generic observability facades instead of importing vendor SDKs directly:

```text
analytics.track(...)
errors.capture(...)
logs.info(...)
replay.identify(...)
flags.isEnabled(...)
```

The default adapter maps those calls to PostHog properties:

```text
project_slug
app_environment
preview_id
git_sha
request_id
job_id
stripe_event_id
```

This keeps shared PostHog projects filterable while preserving a future path to dedicated PostHog projects or optional specialist adapters.

## Operations

Provider-specific failures become normalized incidents. Incidents reference evidence rather than copying large logs directly. Slack, CLI, dashboards, and MCP tools should all operate on the same incident/action registry.

## R2 Event Forwarding

R2 bucket events are handled through Cloudflare-native primitives first:

```text
R2 bucket event
  -> Cloudflare Queue
  -> r2-event-forwarder Worker
  -> signed POST /api/webhook/cloudflare/r2
  -> generated app handler
```

The Worker signs each forwarded batch with `R2_EVENT_WEBHOOK_SECRET`. The Next route verifies the timestamped HMAC before calling `handleCloudflareR2EventBatch`, where project-specific logic can be added.

Cloudflare Queues use at-least-once delivery, so generated handlers treat forwarded events as repeatable. The Worker acknowledges each successfully forwarded queue message and retries failed messages individually. The Next app stores each webhook in a generic `webhook_events` table with a unique `(provider, idempotency_key)` constraint before running side effects. Failed events can be retried; processed duplicates are skipped.
