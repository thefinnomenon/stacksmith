# Stacksmith

Forge full-stack apps from blueprint to production.

Stacksmith is a local-first project bootstrap and operations control plane. It is designed to generate a production-minded app foundation, model the infrastructure it needs, and eventually provision the services through provider adapters.

The current repository is an MVP foundation. Most provider automation is still exposed as explicit, inspectable command plans. Cloudflare R2 S3 credential creation is implemented as an opt-in live API flow.

Default stack decision:

- Web: Vercel.
- Database: Prisma Postgres through the Vercel Marketplace, used with Prisma ORM.
- File storage, object-event forwarding, domains, DNS, and development tunnels: Cloudflare R2, Queues/Workers, Registrar/DNS, and Tunnel.
- Background jobs and long-running work: Google Cloud Run.
- Email, observability/product data, payments, and notifications: Resend, PostHog, Stripe, and Slack.
- PostHog allocation: new apps use a shared `stacksmith-incubator` PostHog project with mandatory `project_slug` and environment tags, then promote serious apps to dedicated PostHog projects.

What exists:

- TypeScript CLI with command-line and interactive `init`.
- Declarative project manifest at `.stacksmith/project.json`.
- Separate generated state file at `.stacksmith/state.json`.
- Provider adapter lifecycle: `inspect`, `plan`, `apply`, `health`.
- Scaffold adapters for GitHub, Vercel, Google Cloud Run, Prisma Postgres, Cloudflare, Resend, Stripe, PostHog, and Slack.
- Environment model for development, preview, staging, and production.
- Preview metadata helpers and PostHog observability tag helpers.
- Generated Cloudflare R2 event forwarder Worker and signed Next webhook at `/api/webhook/cloudflare/r2`.
- Opt-in Cloudflare R2 S3 credential generation that writes `R2_*` values to an env file without printing secrets.
- Unified incident, evidence, action registry, Slack action message, and Slack signature scaffolding.
- Postgres schema for jobs, audit events, incidents, preview metadata, Stripe preview routing, and database-backed feature flags.
- MCP-facing tool registry stub for future Codex access to incidents, evidence, health, and actions.

What does not exist yet:

- Real lifecycle API adapters for most providers.
- General secret storage or rotation.
- Actual Slack app installation or posting.
- AI diagnosis/fix execution.
- Running job worker.
- Hosted MCP server.

## Quick Start

```bash
npm install
npm run build
npm test
```

Create a new project:

```bash
npm run dev -- create FaceReel ./sandbox/facereel --domain facereel.com --backend hybrid
```

Create a project under a domain you already own:

```bash
npm run dev -- create Push ./sandbox/push --base-domain finternet.com --project-subdomain push
```

Inspect the plan:

```bash
npm run dev -- plan
```

Inspect planned provider commands:

```bash
npm run dev -- commands --provider cloud-run
```

Inspect planned undo commands:

```bash
npm run dev -- commands --provider cloud-run --undo
```

Run opt-in live provider tests:

```bash
STACKSMITH_LIVE_GITHUB_TEST=1 npm test -- src/tests/github-live.test.ts
```

The live GitHub tests create private temporary repositories, verify them, run the Stacksmith undo flow, and verify deletion. They require GitHub CLI authentication with repository deletion permissions:

```bash
gh auth refresh -h github.com -s delete_repo
```

Generate R2 S3 credentials for a generated app env file:

```bash
npm run dev -- cloudflare setup-token --open
pbpaste | npm run dev -- cloudflare setup-token --token-stdin --save --execute
npm run dev -- cloudflare setup-workers --open --execute
npm run dev -- r2 credentials --environment development --execute
```

This command infers `CLOUDFLARE_ACCOUNT_ID` from `wrangler whoami` when possible, creates a scoped Cloudflare API token for the environment bucket, writes `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `FILES_URL`, and `R2_PREFIX` into `.env.local`, and does not print secret values. It requires a parent token with Cloudflare API token write permission. By default `cloudflare setup-token --save` stores that operator token in `~/.stacksmith/env.local`, which `r2 credentials` reads automatically.

`cloudflare setup-workers --open --execute` opens the Cloudflare Workers & Pages account setup page and verifies the account-level `workers.dev` subdomain when the token has permission to read it. Cloudflare requires this one-time account setup before a Queue can be attached to the generated R2 event forwarder Worker, even when the Worker itself disables public `workers.dev` routes.

Sync those R2 values into Vercel for a target environment:

```bash
npm run dev -- vercel env sync-r2 --environment development --from-env-path .env.local --execute
```

Undo the Vercel env sync when testing teardown:

```bash
npm run dev -- vercel env delete-r2 --environment development --execute
```

Use `--env-path` for Stacksmith env-writing commands and `--from-env-path` for reading an existing app env file. Avoid `--env-file` with `npm run dev` because recent Node versions reserve that flag.

```bash
export CLOUDFLARE_API_TOKEN=...
```

The command prints the created token ID and undo command:

```bash
npm run dev -- r2 token delete --token-id <token-id> --execute
```

Cloud Run plans include creating a Google Cloud project, linking billing, enabling APIs, creating an Artifact Registry repository, and deploying the API service and worker job. Stacksmith generates a default project ID such as `ss-facereel` in `.stacksmith/project.json`; edit `providers.cloud-run.projectId` if that globally unique Google Cloud project ID is unavailable.

Before executing the Cloud Run billing step, authenticate with `gcloud` and set:

```bash
export GOOGLE_CLOUD_BILLING_ACCOUNT_ID=XXXXXX-XXXXXX-XXXXXX
```

Prisma Postgres plans target the Vercel Marketplace integration. They prepare billing authorization, database creation, and project connection commands, but live deletion/disconnection is not implemented yet. Before testing them, install the Prisma integration in the target Vercel team and set:

```bash
export VERCEL_TOKEN=vercel_pat_...
export VERCEL_TEAM_ID=team_...
export PRISMA_INTEGRATION_CONFIG_ID=icfg_...
export PRISMA_POSTGRES_REGION=iad1
export PRISMA_BILLING_PLAN=free
```

Apply local scaffold state:

```bash
npm run dev -- apply --yes
```

Check health:

```bash
npm run dev -- health
```

Print the Postgres schema:

```bash
npm run dev -- schema
```

List future MCP tools:

```bash
npm run dev -- mcp-tools
```

Or launch the interactive project init menu:

```bash
npm run dev -- create
```

## Concepts

- **Blueprint**: the project manifest in `.stacksmith/project.json`.
- **State**: generated provider identifiers and scaffold status in `.stacksmith/state.json`.
- **Provider**: a lifecycle adapter for a platform such as GitHub, Vercel, Cloudflare, PostHog, or Slack.
- **Incident**: a normalized operational problem with evidence and available actions.
- **Action**: a safe, auditable operation such as retrying a job or opening a PostHog issue/log/replay.

## Phase 1 Boundary

`apply` only writes local scaffold state. It deliberately prints that no real provider API calls were made. Real adapters can be implemented incrementally behind the same lifecycle without changing the CLI contract.

`commands` is the bridge toward real provisioning. Each provider command can define:

- an idempotency check, so `commands --execute` can skip work that already exists;
- an undo command, so test resources can be torn down after validation;
- required environment variables, so secrets are not stored in Stacksmith state.

Some operations are inherently not reversible, such as domain registration or one-shot job execution. Those commands use explicit no-op undo steps so the plan remains honest instead of pretending deletion is safe.

Provider-specific direct commands, such as `r2 credentials`, may make live API calls only when `--execute` is provided.

## Docs

- [Architecture](docs/architecture.md)
- [URL strategy](docs/url-strategy.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
