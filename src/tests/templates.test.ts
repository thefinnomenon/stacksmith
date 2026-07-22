import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDefaultManifest } from "../core/defaults.js";
import { generateAppSkeleton } from "../templates/app.js";

test("generateAppSkeleton writes a Next-style app foundation", async () => {
  const root = await mkdtemp(join(tmpdir(), "stacksmith-app-"));
  const manifest = createDefaultManifest({ name: "FaceReel", domain: "facereel.com" });
  const result = await generateAppSkeleton({ manifest, targetDir: root });

  assert.equal(result.skipped.length, 0);
  assert.ok(result.written.includes("app/api/health/route.ts"));
  assert.ok(result.written.includes("app/api/webhook/cloudflare/r2/route.ts"));
  assert.ok(result.written.includes("lib/observability.ts"));
  assert.ok(result.written.includes("lib/storage.ts"));
  assert.ok(result.written.includes("lib/stacksmith-webhook.ts"));
  assert.ok(result.written.includes("lib/cloudflare-r2-events.ts"));
  assert.ok(result.written.includes("prisma/schema.prisma"));
  assert.ok(result.written.includes("tests/storage.test.ts"));
  assert.ok(result.written.includes("tests/stacksmith-webhook.test.ts"));
  assert.ok(result.written.includes(".stacksmith/r2-cors.json"));
  assert.ok(result.written.includes("workers/r2-event-forwarder/wrangler.jsonc"));
  assert.ok(result.written.includes("workers/r2-event-forwarder/src/index.ts"));
  assert.ok(result.written.includes("workers/r2-event-forwarder/src/index.test.ts"));

  const packageJson = await readFile(join(root, "package.json"), "utf8");
  const envExample = await readFile(join(root, ".env.example"), "utf8");
  const cors = await readFile(join(root, ".stacksmith/r2-cors.json"), "utf8");
  const route = await readFile(join(root, "app/api/webhook/cloudflare/r2/route.ts"), "utf8");
  const storage = await readFile(join(root, "lib/storage.ts"), "utf8");
  const webhook = await readFile(join(root, "lib/stacksmith-webhook.ts"), "utf8");
  const worker = await readFile(join(root, "workers/r2-event-forwarder/src/index.ts"), "utf8");
  const workerTest = await readFile(join(root, "workers/r2-event-forwarder/src/index.test.ts"), "utf8");
  const wrangler = await readFile(join(root, "workers/r2-event-forwarder/wrangler.jsonc"), "utf8");
  const storageTest = await readFile(join(root, "tests/storage.test.ts"), "utf8");
  const webhookIdempotency = await readFile(join(root, "lib/webhook-idempotency.ts"), "utf8");
  const r2Events = await readFile(join(root, "lib/cloudflare-r2-events.ts"), "utf8");
  const prismaSchema = await readFile(join(root, "prisma/schema.prisma"), "utf8");
  assert.equal(packageJson.includes("\"@aws-sdk/s3-request-presigner\""), true);
  assert.match(packageJson, /"test": "node --import tsx --test/);
  assert.match(envExample, /STACKSMITH_PROJECT=facereel/);
  assert.match(envExample, /APP_URL=https:\/\/dev\.facereel\.com/);
  assert.match(envExample, /^R2_EVENT_WEBHOOK_SECRET=$/m);
  assert.match(envExample, /^R2_BUCKET_NAME=facereel-dev$/m);
  assert.match(cors, /https:\/\/facereel\.com/);
  assert.match(route, /handleCloudflareR2EventBatch/);
  assert.match(route, /verifyStacksmithWebhookSignature/);
  assert.match(storage, /class R2StorageClient/);
  assert.match(storage, /createPresignedPutUrl/);
  assert.match(storage, /R2 storage is not configured/);
  assert.match(webhook, /x-stacksmith-signature/);
  assert.match(worker, /R2_EVENT_FORWARD_URL/);
  assert.match(worker, /message\.ack\(\)/);
  assert.match(worker, /message\.retry\(\{ delaySeconds: 30 \}\)/);
  assert.match(worker, /cloudflare\.r2\.forwarded/);
  assert.match(workerTest, /posts signed event envelopes/);
  assert.match(workerTest, /verifyStacksmithWebhookSignature/);
  assert.match(wrangler, /facereel-r2-events/);
  assert.match(wrangler, /https:\/\/facereel\.com\/api\/webhook\/cloudflare\/r2/);
  assert.match(storageTest, /STACKSMITH_LIVE_R2_STORAGE_TEST/);
  assert.match(webhookIdempotency, /provider_idempotencyKey/);
  assert.match(webhookIdempotency, /existing\?\.status === "failed"/);
  assert.match(r2Events, /cloudflareR2EventIdempotencyKey/);
  assert.match(r2Events, /startWebhookEvent/);
  assert.match(prismaSchema, /@@unique\(\[provider, idempotencyKey\]\)/);
});

test("generateAppSkeleton skips existing files unless forced", async () => {
  const root = await mkdtemp(join(tmpdir(), "stacksmith-app-"));
  const manifest = createDefaultManifest({ name: "FaceReel" });

  await generateAppSkeleton({ manifest, targetDir: root });
  const second = await generateAppSkeleton({ manifest, targetDir: root });

  assert.equal(second.written.length, 0);
  assert.ok(second.skipped.length > 0);
});
