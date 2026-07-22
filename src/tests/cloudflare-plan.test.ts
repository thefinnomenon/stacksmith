import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultManifest } from "../core/defaults.js";
import { cloudflareCommandPlan, r2CorsRules } from "../providers/cloudflare-plan.js";

test("Cloudflare plan includes registrar, CORS, tunnel, and DNS commands", () => {
  const manifest = createDefaultManifest({ name: "FaceReel", domain: "facereel.com" });
  const commands = cloudflareCommandPlan(manifest);

  assert.ok(commands.some((command) => command.id === "cloudflare.domain.search"));
  assert.ok(commands.some((command) => command.id === "cloudflare.domain.register" && command.risk === "production-write"));
  assert.ok(commands.some((command) => command.id === "cloudflare.r2.cors.production"));
  const createDevBucket = commands.find((command) => command.id === "cloudflare.r2.dev");
  const configureDevCors = commands.find((command) => command.id === "cloudflare.r2.cors.dev");
  const domainSearch = commands.find((command) => command.id === "cloudflare.domain.search");
  assert.ok(createDevBucket);
  assert.equal(createDevBucket.env, undefined);
  assert.equal(createDevBucket.undo?.stdin, "y\n");
  assert.ok(configureDevCors);
  assert.equal(configureDevCors.env, undefined);
  assert.equal(configureDevCors.args.includes("--force"), true);
  assert.equal(configureDevCors.undo?.args.includes("--force"), true);
  assert.ok(domainSearch);
  assert.deepEqual(domainSearch.env, ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
  assert.ok(commands.some((command) => command.id === "cloudflare.r2.events.queue"));
  const eventQueue = commands.find((command) => command.id === "cloudflare.r2.events.queue");
  assert.equal(eventQueue?.env, undefined);
  assert.equal(eventQueue?.undo?.stdin, "y\n");
  assert.ok(commands.some((command) => command.id === "cloudflare.r2.events.worker.deploy"));
  assert.ok(commands.some((command) => command.id === "cloudflare.r2.events.worker.secret"));
  const productionNotifications = commands.find((command) => command.id === "cloudflare.r2.events.notification.production");
  assert.ok(productionNotifications);
  assert.deepEqual(
    productionNotifications.args.filter((arg) => arg === "object-create" || arg === "object-delete"),
    ["object-create", "object-delete"]
  );
  assert.ok(commands.some((command) => command.id === "cloudflare.r2.custom-domain.production"));
  assert.ok(commands.some((command) => command.id === "cloudflare.dns.root"));
  assert.equal(commands.some((command) => command.args.some((arg) => arg.includes("facereel-production.r2.dev"))), false);
});

test("R2 CORS rules include app origins and upload methods", () => {
  const manifest = createDefaultManifest({ name: "FaceReel", domain: "facereel.com" });
  const rules = r2CorsRules(manifest);

  assert.deepEqual(rules.rules[0]?.allowed.methods, ["GET", "HEAD", "PUT", "POST", "DELETE"]);
  assert.ok(rules.rules[0]?.allowed.origins.includes("https://facereel.com"));
});

test("Cloudflare free mode skips registrar and DNS commands", () => {
  const manifest = createDefaultManifest({ name: "FaceReel" });
  const commands = cloudflareCommandPlan(manifest);

  assert.equal(commands.some((command) => command.id.startsWith("cloudflare.domain.")), false);
  assert.equal(commands.some((command) => command.id.startsWith("cloudflare.dns.")), false);
  assert.ok(commands.some((command) => command.id === "cloudflare.r2.cors.dev"));
  assert.ok(commands.some((command) => command.id === "cloudflare.r2.events.queue"));
  assert.ok(commands.some((command) => command.id === "cloudflare.tunnel.quick.web"));
  assert.equal(commands.some((command) => command.id === "cloudflare.tunnel.route.dev"), false);
});
