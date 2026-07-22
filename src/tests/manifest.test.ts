import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultManifest, slugify } from "../core/defaults.js";
import { buildObservabilityTags } from "../operations/incidents.js";

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
  assert.equal(manifest.previews.observability, "posthog-tagged");
  assert.equal(manifest.providers["cloud-run"].projectId, "ss-facereel");
  assert.equal(manifest.providers["prisma-postgres"].via, "vercel-marketplace");
  assert.equal(manifest.providers["prisma-postgres"].previewProvisioning, "github-actions-management-api");
  assert.equal(manifest.providers["prisma-postgres"].acceleration?.connectionPooling, true);
  assert.equal(manifest.providers["prisma-postgres"].acceleration?.queryCache, "optional-per-query");
  assert.equal(manifest.providers.cloudflare.r2, true);
  assert.equal(manifest.providers.cloudflare.r2Events, true);
  assert.deepEqual(manifest.providers.cloudflare.r2EventTypes, ["object-create", "object-delete"]);
  assert.equal(manifest.providers.cloudflare.r2EventForwarder?.queueName, "facereel-r2-events");
  assert.equal(manifest.providers.cloudflare.r2EventForwarder?.workerName, "facereel-r2-event-forwarder");
  assert.equal(manifest.providers.cloudflare.r2EventForwarder?.endpointPath, "/api/webhook/cloudflare/r2");
  assert.equal(manifest.providers.cloudflare.dns, true);
  assert.equal(manifest.providers.cloudflare.tunnel, true);
  assert.equal(manifest.providers.stripe.previewRouter, true);
  assert.equal(manifest.providers.posthog.allocation, "shared-incubator");
  assert.equal(manifest.providers.posthog.sharedProjectName, "stacksmith-incubator");
  assert.equal(manifest.providers.posthog.errorTracking, true);
  assert.equal(manifest.providers.posthog.logs, true);
  assert.equal(manifest.providers.posthog.slackRoutingTags, true);
  assert.equal(manifest.providers.slack.activityChannel, "facereel");
  assert.equal(manifest.providers.slack.alertsChannel, "facereel-alerts");
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

test("observability tags keep preview as the environment and PR as a tag", () => {
  const tags = buildObservabilityTags({
    environment: "preview",
    projectSlug: "facereel",
    previewId: "pr-184",
    pullRequestNumber: 184,
    gitBranch: "feat/billing",
    gitSha: "abc123",
    deploymentProvider: "cloud-run"
  });

  assert.equal(tags.app_environment, "preview");
  assert.equal(tags.project_slug, "facereel");
  assert.equal(tags.preview_id, "pr-184");
  assert.equal(tags.github_pr, "184");
});
