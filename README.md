# Stacksmith

Forge full-stack apps from blueprint to production.

Stacksmith is a local-first project bootstrap and operations control plane. It is designed to generate a production-minded app foundation, model the infrastructure it needs, and eventually provision the services through provider adapters.

The current repository is an MVP foundation. It intentionally does not perform real cloud provisioning yet.

What exists:

- TypeScript CLI with command-line and interactive `init`.
- Declarative project manifest at `.stacksmith/project.json`.
- Separate generated state file at `.stacksmith/state.json`.
- Provider adapter lifecycle: `inspect`, `plan`, `apply`, `health`.
- Scaffold adapters for GitHub, Vercel, Google Cloud Run, Prisma Postgres, Cloudflare, Resend, Stripe, Sentry, Mixpanel, and Slack.
- Environment model for development, preview, staging, and production.
- Preview metadata helpers and Sentry tag helpers.
- Unified incident, evidence, action registry, Slack action message, and Slack signature scaffolding.
- Postgres schema for jobs, audit events, incidents, preview metadata, Stripe preview routing, and database-backed feature flags.
- MCP-facing tool registry stub for future Codex access to incidents, evidence, health, and actions.

What does not exist yet:

- Real cloud provider API calls.
- Secret creation, storage, or rotation.
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

Cloud Run plans include creating a Google Cloud project, linking billing, enabling APIs, creating an Artifact Registry repository, and deploying the API service and worker job. Stacksmith generates a default project ID such as `ss-facereel` in `.stacksmith/project.json`; edit `providers.cloud-run.projectId` if that globally unique Google Cloud project ID is unavailable.

Before executing the Cloud Run billing step, authenticate with `gcloud` and set:

```bash
export GOOGLE_CLOUD_BILLING_ACCOUNT_ID=XXXXXX-XXXXXX-XXXXXX
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
- **Provider**: a lifecycle adapter for a platform such as GitHub, Vercel, Cloudflare, Sentry, or Slack.
- **Incident**: a normalized operational problem with evidence and available actions.
- **Action**: a safe, auditable operation such as retrying a job or opening a Sentry issue.

## Phase 1 Boundary

`apply` only writes local scaffold state. It deliberately prints that no real provider API calls were made. Real adapters can be implemented incrementally behind the same lifecycle without changing the CLI contract.

`commands` is the bridge toward real provisioning. Each provider command can define:

- an idempotency check, so `commands --execute` can skip work that already exists;
- an undo command, so test resources can be torn down after validation;
- required environment variables, so secrets are not stored in Stacksmith state.

Some operations are inherently not reversible, such as domain registration or one-shot job execution. Those commands use explicit no-op undo steps so the plan remains honest instead of pretending deletion is safe.

## Docs

- [Architecture](docs/architecture.md)
- [URL strategy](docs/url-strategy.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
