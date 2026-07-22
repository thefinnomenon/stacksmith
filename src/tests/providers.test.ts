import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultManifest } from "../core/defaults.js";
import { applyAll, planAll, healthAll } from "../core/orchestrator.js";
import { createInitialState } from "../core/state.js";
import { providers } from "../providers/index.js";

test("provider registry includes the planned MVP stack", () => {
  assert.deepEqual(
    providers.map((provider) => provider.id),
    [
      "github",
      "vercel",
      "cloud-run",
      "prisma-postgres",
      "cloudflare",
      "resend",
      "stripe",
      "posthog",
      "slack"
    ]
  );
});

test("plan and apply update local scaffold state without real provider calls", async () => {
  const manifest = createDefaultManifest({ name: "FaceReel", domain: "facereel.com" });
  const state = createInitialState(manifest);
  const plan = await planAll(manifest, state);

  assert.equal(plan.changes.filter((change) => change.action === "create").length, providers.length);

  const results = await applyAll(manifest, state, plan.changes);
  assert.equal(results.length, providers.length);
  assert.equal(state.providers.github?.status, "applied");
  assert.equal(state.providers.vercel?.resources.some((resource) => resource.kind === "project" && resource.name === "facereel"), true);
  assert.equal(
    state.providers.vercel?.resources.some(
      (resource) => resource.kind === "env-contract" && resource.name === "staging-environment-variables"
    ),
    true
  );
  assert.equal(
    state.providers.vercel?.resources.some(
      (resource) => resource.kind === "domain-attachment" && resource.metadata?.dnsProvider === "cloudflare"
    ),
    true
  );
  assert.equal(state.providers.cloudflare?.resources.some((resource) => resource.kind === "r2-bucket"), true);
  assert.equal(state.providers.cloudflare?.resources.some((resource) => resource.kind === "queue" && resource.name === "facereel-r2-events"), true);
  assert.equal(state.providers.cloudflare?.resources.some((resource) => resource.kind === "worker" && resource.name === "facereel-r2-event-forwarder"), true);
  assert.equal(
    state.providers["prisma-postgres"]?.resources.some(
      (resource) => resource.kind === "vercel-marketplace-integration" && resource.metadata?.via === "vercel-marketplace"
    ),
    true
  );
  assert.equal(
    state.providers["prisma-postgres"]?.resources.some(
      (resource) => resource.kind === "vercel-marketplace-resource-connection"
        && Array.isArray(resource.metadata?.injectedEnvironmentVariables)
    ),
    true
  );
  assert.equal(
    state.providers["prisma-postgres"]?.resources.some(
      (resource) => resource.kind === "migration-env-policy" && resource.metadata?.directUrl === "DIRECT_DATABASE_URL"
    ),
    true
  );
  assert.equal(
    state.providers.posthog?.resources.some(
      (resource) => resource.kind === "project-allocation" && resource.metadata?.allocation === "shared-incubator"
    ),
    true
  );

  const health = await healthAll(manifest, state);
  assert.equal(health.every((result) => result.status === "healthy"), true);
});

test("Vercel and Prisma provider plans are idempotent after local apply", async () => {
  const manifest = createDefaultManifest({ name: "FaceReel", domain: "facereel.com" });
  const state = createInitialState(manifest);
  const firstPlan = await planAll(manifest, state);

  await applyAll(manifest, state, firstPlan.changes);

  const secondPlan = await planAll(manifest, state);
  const vercel = secondPlan.changes.find((change) => change.provider === "vercel");
  const prisma = secondPlan.changes.find((change) => change.provider === "prisma-postgres");

  assert.ok(vercel);
  assert.ok(prisma);
  assert.equal(vercel.action, "noop");
  assert.equal(prisma.action, "noop");
});

test("Prisma provider detects marketplace preview strategy changes", async () => {
  const manifest = createDefaultManifest({ name: "FaceReel", domain: "facereel.com" });
  const state = createInitialState(manifest);
  const firstPlan = await planAll(manifest, state);
  await applyAll(manifest, state, firstPlan.changes);

  manifest.providers["prisma-postgres"].previewProvisioning = "vercel-preview-env";
  const updatedPlan = await planAll(manifest, state);
  const prisma = updatedPlan.changes.find((change) => change.provider === "prisma-postgres");

  assert.ok(prisma);
  assert.equal(prisma.action, "update");
  assert.equal(prisma.id, "prisma-postgres:update-marketplace-spine");
});
