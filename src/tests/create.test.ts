import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProject, defaultCreateTargetDir } from "../core/create.js";

test("defaultCreateTargetDir uses a slugged project name", () => {
  assert.equal(defaultCreateTargetDir("Face Reel!"), "./face-reel");
});

test("createProject writes Stacksmith state and app files into one project root", async () => {
  const root = await mkdtemp(join(tmpdir(), "stacksmith-create-"));
  const result = await createProject({
    name: "FaceReel",
    domain: "facereel.com",
    targetDir: root
  });

  assert.equal(result.manifest.slug, "facereel");
  assert.ok(result.app.written.includes("package.json"));
  assert.ok(result.app.written.includes("app/api/health/route.ts"));

  const manifest = await readFile(join(root, ".stacksmith/project.json"), "utf8");
  const packageJson = await readFile(join(root, "package.json"), "utf8");

  assert.match(manifest, /"slug": "facereel"/);
  assert.match(packageJson, /"name": "facereel"/);
});

test("createProject supports project subdomain mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "stacksmith-create-"));
  const result = await createProject({
    name: "Push",
    baseDomain: "finternet.com",
    projectSubdomain: "push",
    targetDir: root
  });

  assert.equal(result.manifest.domainMode, "subdomain");
  assert.equal(result.manifest.domain, "push.finternet.com");
});
