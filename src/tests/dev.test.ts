import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultManifest } from "../core/defaults.js";
import { planDevSession } from "../core/dev.js";

test("dev session uses named tunnel for subdomain mode", () => {
  const manifest = createDefaultManifest({
    name: "Push",
    baseDomain: "finternet.com",
    projectSubdomain: "push"
  });
  const plan = planDevSession(manifest);

  assert.equal(plan.mode, "named-tunnel");
  assert.equal(plan.envUpdates.APP_URL, "https://dev.push.finternet.com");
  assert.ok(plan.notes.some((note) => note.includes("stable social OAuth")));
});

test("dev session uses quick tunnel for free mode", () => {
  const manifest = createDefaultManifest({ name: "Push" });
  const plan = planDevSession(manifest);

  assert.equal(plan.mode, "quick-tunnel");
  assert.equal(plan.envUpdates.APP_URL, "http://localhost:3000");
  assert.ok(plan.notes.some((note) => note.includes("ephemeral")));
});
