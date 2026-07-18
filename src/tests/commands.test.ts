import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultManifest } from "../core/defaults.js";
import { formatExternalCommand, missingCommandEnv, runExternalCommand } from "../core/commands.js";
import { allProviderCommandPlans } from "../providers/command-plans.js";

test("provider command plans expose future external operations", () => {
  const manifest = createDefaultManifest({ name: "FaceReel", domain: "facereel.com" });
  const commands = allProviderCommandPlans(manifest);

  assert.equal(commands.some((command) => command.id === "github.repo.create"), true);
  assert.equal(commands.some((command) => command.id === "cloudflare.r2.dev"), true);
  assert.equal(commands.some((command) => command.id === "cloudflare.r2.cors.dev"), true);
  assert.equal(commands.some((command) => command.id === "cloudflare.domain.check"), true);
  assert.equal(commands.some((command) => command.id === "cloud-run.project.create"), true);
  assert.equal(commands.some((command) => command.id === "cloud-run.billing.link"), true);
  assert.equal(commands.some((command) => command.id === "cloud-run.services.enable"), true);
  assert.equal(commands.some((command) => command.id === "cloud-run.artifact-registry.create"), true);
  assert.equal(commands.some((command) => command.id === "vercel.env.production.APP_URL"), true);
  assert.equal(commands.filter((command) => command.risk !== "read-only").every((command) => command.requiresConfirmation), true);
  assert.equal(commands.every((command) => Boolean(command.undo)), true);
});

test("Cloud Run commands target the manifest Google Cloud project", () => {
  const manifest = createDefaultManifest({ name: "FaceReel" });
  const commands = allProviderCommandPlans(manifest);
  const createProject = commands.find((command) => command.id === "cloud-run.project.create");
  const deployApi = commands.find((command) => command.id === "cloud-run.api.deploy");
  const billing = commands.find((command) => command.id === "cloud-run.billing.link");

  assert.ok(createProject);
  assert.ok(deployApi);
  assert.ok(billing);
  assert.equal(createProject.args.includes("ss-facereel"), true);
  assert.equal(deployApi.args.includes("--project"), true);
  assert.equal(deployApi.args.includes("ss-facereel"), true);
  assert.deepEqual(billing.env, ["GOOGLE_CLOUD_BILLING_ACCOUNT_ID"]);
  assert.equal(createProject.check?.args.includes("ss-facereel"), true);
  assert.equal(createProject.undo?.args.includes("ss-facereel"), true);
});

test("formatExternalCommand shell-quotes arguments with spaces", () => {
  assert.equal(
    formatExternalCommand({
      provider: "github",
      id: "example",
      description: "Example",
      command: "tool",
      args: ["hello world"],
      risk: "read-only",
      requiresConfirmation: false
    }),
    "tool 'hello world'"
  );
});

test("formatExternalCommand can render undo commands", () => {
  const manifest = createDefaultManifest({ name: "FaceReel" });
  const command = allProviderCommandPlans(manifest).find((item) => item.id === "cloud-run.project.create");

  assert.ok(command);
  assert.equal(formatExternalCommand(command, "undo"), "gcloud projects delete ss-facereel --quiet");
});

test("runExternalCommand plans by default and validates env before execution", async () => {
  const command = {
    provider: "github" as const,
    id: "example",
    description: "Example",
    command: "tool",
    args: ["run"],
    risk: "read-only" as const,
    requiresConfirmation: false,
    env: ["REQUIRED_TOKEN"]
  };

  assert.deepEqual(missingCommandEnv(command, {}), ["REQUIRED_TOKEN"]);
  assert.equal((await runExternalCommand({ command, execute: false })).status, "planned");
  assert.equal((await runExternalCommand({ command, execute: true, env: {} })).status, "skipped");
});

test("runExternalCommand skips apply when idempotency check passes", async () => {
  const command = {
    provider: "github" as const,
    id: "example",
    description: "Example",
    command: "node",
    args: ["-e", "process.exit(1)"],
    risk: "read-only" as const,
    requiresConfirmation: false,
    check: {
      description: "Example already exists.",
      command: "node",
      args: ["-e", "process.stdout.write('exists')"],
      stdoutIncludes: "exists"
    }
  };

  const result = await runExternalCommand({ command, execute: true });
  assert.equal(result.status, "skipped");
  assert.equal(result.message, "Already satisfied: Example already exists.");
});

test("runExternalCommand plans undo commands", async () => {
  const command = {
    provider: "github" as const,
    id: "example",
    description: "Example",
    command: "tool",
    args: ["run"],
    risk: "read-only" as const,
    requiresConfirmation: false,
    undo: {
      description: "Undo example.",
      command: "tool",
      args: ["undo"],
      risk: "read-only" as const,
      requiresConfirmation: false
    }
  };

  const result = await runExternalCommand({ command, execute: false, mode: "undo" });
  assert.equal(result.status, "planned");
  assert.equal(result.message, "Prepared undo command only: tool undo");
});
