import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultManifest, slugify } from "../core/defaults.js";
import { buildSentryTags } from "../operations/incidents.js";

test("slugify creates stable project slugs", () => {
  assert.equal(slugify("Face Reel!"), "face-reel");
  assert.equal(slugify("  My_App 2026 "), "my-app-2026");
});

test("default manifest models all environments and preview tagging", () => {
  const manifest = createDefaultManifest({ name: "FaceReel", domain: "facereel.com" });

  assert.equal(manifest.slug, "facereel");
  assert.equal(manifest.domainMode, "managed");
  assert.equal(manifest.backendMode, "hybrid");
  assert.equal(manifest.environments.production.appUrl, "https://facereel.com");
  assert.equal(manifest.environments.development.appUrl, "https://dev.facereel.com");
  assert.equal(manifest.previews.database, "isolated");
  assert.equal(manifest.previews.sentry, "tagged");
  assert.equal(manifest.providers["cloud-run"].projectId, "ss-facereel");
  assert.equal(manifest.providers.cloudflare.r2, true);
  assert.equal(manifest.providers.stripe.previewRouter, true);
});

test("default manifest without a domain uses seamless free provider URLs", () => {
  const manifest = createDefaultManifest({ name: "FaceReel" });

  assert.equal(manifest.domainMode, "free");
  assert.equal(manifest.environments.production.appUrl, "https://facereel.vercel.app");
  assert.equal(manifest.environments.production.apiUrl, "https://facereel-api-{region}.a.run.app");
  assert.equal(manifest.environments.production.filesUrl, "https://facereel-production.r2.dev");
  assert.equal(manifest.environments.development.appUrl, "http://localhost:3000");
});

test("default manifest can use a project subdomain on a base domain", () => {
  const manifest = createDefaultManifest({
    name: "Push",
    baseDomain: "finternet.com",
    projectSubdomain: "push"
  });

  assert.equal(manifest.domainMode, "subdomain");
  assert.equal(manifest.domainConfig.activeDomain, "push.finternet.com");
  assert.equal(manifest.environments.production.appUrl, "https://push.finternet.com");
  assert.equal(manifest.environments.development.appUrl, "https://dev.push.finternet.com");
  assert.equal(manifest.environments.production.filesUrl, "https://files.push.finternet.com");
});

test("Sentry tags keep preview as the environment and PR as a tag", () => {
  const tags = buildSentryTags({
    environment: "preview",
    previewId: "pr-184",
    pullRequestNumber: 184,
    gitBranch: "feat/billing",
    gitSha: "abc123",
    deploymentProvider: "cloud-run"
  });

  assert.equal(tags.environment, "preview");
  assert.equal(tags.preview_id, "pr-184");
  assert.equal(tags.github_pr, "184");
});
