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
  assert.ok(result.written.includes("lib/observability.ts"));
  assert.ok(result.written.includes("prisma/schema.prisma"));
  assert.ok(result.written.includes(".stacksmith/r2-cors.json"));

  const envExample = await readFile(join(root, ".env.example"), "utf8");
  const cors = await readFile(join(root, ".stacksmith/r2-cors.json"), "utf8");
  assert.match(envExample, /STACKSMITH_PROJECT=facereel/);
  assert.match(envExample, /APP_URL=https:\/\/dev\.facereel\.com/);
  assert.match(envExample, /^R2_BUCKET_NAME=facereel-dev$/m);
  assert.match(cors, /https:\/\/facereel\.com/);
});

test("generateAppSkeleton skips existing files unless forced", async () => {
  const root = await mkdtemp(join(tmpdir(), "stacksmith-app-"));
  const manifest = createDefaultManifest({ name: "FaceReel" });

  await generateAppSkeleton({ manifest, targetDir: root });
  const second = await generateAppSkeleton({ manifest, targetDir: root });

  assert.equal(second.written.length, 0);
  assert.ok(second.skipped.length > 0);
});
