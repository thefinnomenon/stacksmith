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

## Operations

Provider-specific failures become normalized incidents. Incidents reference evidence rather than copying large logs directly. Slack, CLI, dashboards, and MCP tools should all operate on the same incident/action registry.
