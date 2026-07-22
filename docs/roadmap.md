# Roadmap

## Phase 1: Local Foundation

- CLI with command-line and interactive mode.
- Manifest and state files.
- Provider lifecycle interfaces.
- Local scaffold adapters.
- Project creation with manifest, state, and app skeleton generation.
- Doctor and health checks.
- Incident/action/evidence model.

## Phase 2: First Real Provisioning

- GitHub repo creation through `gh`.
- Vercel project creation and env sync.
- Cloudflare R2 buckets, DNS records, and named dev tunnel configuration.
- Cloudflare R2 bucket event notifications through Queues and a forwarding Worker.
- PostHog project allocation, env sync, and observability facade integration.
- Slack notification posting.

## Phase 3: Previews

- Isolated preview database workflow.
- Cloud Run preview service and job coordination.
- R2 preview prefixes.
- Preview PostHog tagging for errors, logs, analytics, replay, and flags.
- Preview cleanup.

## Phase 4: Operations and AI

- Incident persistence.
- Evidence collection from PostHog, Vercel, Cloud Run, GitHub, jobs, and health checks.
- Slack interactive actions.
- MCP server with incident/log/action tools.
- Bounded AI diagnose/fix loops for preview failures.

## Deliberately Out of Scope for Now

- Replacing Stripe.
- Replacing PostHog.
- Building a full deployment platform before the provider-backed workflow is reliable.
