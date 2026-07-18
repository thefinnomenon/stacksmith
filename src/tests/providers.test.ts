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
      "sentry",
      "mixpanel",
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
  assert.equal(state.providers.cloudflare?.resources.some((resource) => resource.kind === "r2-bucket"), true);

  const health = await healthAll(manifest, state);
  assert.equal(health.every((result) => result.status === "healthy"), true);
});
