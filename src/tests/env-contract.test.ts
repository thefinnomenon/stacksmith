import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultManifest } from "../core/defaults.js";
import { envExample, requiredEnvNames } from "../core/env-contract.js";

test("env contract renders project-specific development examples", () => {
  const manifest = createDefaultManifest({ name: "FaceReel", domain: "facereel.com" });
  const example = envExample(manifest, "development");

  assert.match(example, /STACKSMITH_PROJECT=facereel/);
  assert.match(example, /APP_URL=https:\/\/dev\.facereel\.com/);
  assert.match(example, /AUTH_CALLBACK_URL=https:\/\/dev\.facereel\.com\/api\/auth\/callback/);
  assert.match(example, /EMAIL_LINK_BASE_URL=https:\/\/dev\.facereel\.com/);
  assert.match(example, /STRIPE_WEBHOOK_URL=https:\/\/api\.dev\.facereel\.com\/webhooks\/stripe/);
  assert.match(example, /^R2_BUCKET_NAME=facereel-dev$/m);
  assert.match(example, /^R2_EVENT_WEBHOOK_SECRET=$/m);
  assert.match(example, /EMAIL_FROM=hello@facereel\.com/);
});

test("preview required env includes preview metadata", () => {
  assert.ok(requiredEnvNames("preview").includes("PREVIEW_ID"));
  assert.ok(requiredEnvNames("preview").includes("GITHUB_PR_NUMBER"));
  assert.ok(requiredEnvNames("preview").includes("R2_EVENT_WEBHOOK_SECRET"));
});

test("env contract uses provider URLs when no custom domain exists", () => {
  const manifest = createDefaultManifest({ name: "FaceReel" });
  const example = envExample(manifest, "development");

  assert.match(example, /APP_URL=http:\/\/localhost:3000/);
  assert.match(example, /EMAIL_FROM=hello@facereel\.vercel\.app/);
});
