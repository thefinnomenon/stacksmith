import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runExternalCommand } from "../core/commands.js";
import { createProject } from "../core/create.js";
import { providerCommandPlan } from "../providers/command-plans.js";

const liveCloudflareEnabled = process.env.STACKSMITH_LIVE_CLOUDFLARE_TEST === "1";
const liveCloudflareSkipReason = "Set STACKSMITH_LIVE_CLOUDFLARE_TEST=1 to run live Cloudflare R2 create/CORS/delete tests with the local Wrangler login.";
const testTimeoutMs = 240_000;

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function projectSuffix(): string {
  return randomBytes(3).toString("hex");
}

async function requireCloudflareAuth(): Promise<NodeJS.ProcessEnv> {
  const result = await run("wrangler", ["whoami"]);
  assert.equal(result.exitCode, 0, `Run \`wrangler login\` before live Cloudflare tests.\n${result.stderr}`);
  return process.env;
}

async function run(command: string, args: string[], options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
}): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      resolve({
        exitCode: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: error.message
      });
    });
    child.on("close", (exitCode) => {
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });

    if (options?.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

async function assertBucketExists(bucket: string, env: NodeJS.ProcessEnv): Promise<void> {
  const result = await run("wrangler", ["r2", "bucket", "info", bucket], { env });
  assert.equal(result.exitCode, 0, result.stderr);
}

async function assertBucketDeleted(bucket: string, env: NodeJS.ProcessEnv): Promise<void> {
  const result = await run("wrangler", ["r2", "bucket", "info", bucket], { env });
  assert.notEqual(result.exitCode, 0, "Expected R2 bucket to be deleted.");
}

async function assertCorsConfigured(bucket: string, env: NodeJS.ProcessEnv): Promise<void> {
  const result = await run("wrangler", ["r2", "bucket", "cors", "list", bucket], { env });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /allowed/i);
  assert.match(result.stdout, /localhost:3000|vercel\.app/i);
}

async function cleanupBucket(bucket: string, env: NodeJS.ProcessEnv): Promise<void> {
  await run("wrangler", ["r2", "bucket", "delete", bucket], { env, stdin: "y\n" });
}

test("live Cloudflare command plan creates verifies configures and deletes an R2 bucket", {
  skip: liveCloudflareEnabled ? false : liveCloudflareSkipReason,
  timeout: testTimeoutMs
}, async () => {
  const env = await requireCloudflareAuth();
  const name = `stacksmith-live-r2-${projectSuffix()}`;
  const bucket = `${name}-dev`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-live-r2-")), name);
  const result = await createProject({ name, targetDir: root, force: true });
  const commands = providerCommandPlan("cloudflare", result.manifest)
    .filter((command) => command.id === "cloudflare.r2.dev" || command.id === "cloudflare.r2.cors.dev");
  const previousCwd = process.cwd();

  try {
    assert.deepEqual(commands.map((command) => command.id), ["cloudflare.r2.dev", "cloudflare.r2.cors.dev"]);
    process.chdir(root);

    for (const command of commands) {
      const commandResult = await runExternalCommand({ command, execute: true, env });
      assert.equal(commandResult.status, "executed", commandResult.stderr ?? commandResult.message);
    }

    await assertBucketExists(bucket, env);
    await assertCorsConfigured(bucket, env);

    const deleteBucket = commands.find((command) => command.id === "cloudflare.r2.dev");
    assert.ok(deleteBucket);
    const deleteBucketResult = await runExternalCommand({ command: deleteBucket, execute: true, mode: "undo", env });
    assert.equal(deleteBucketResult.status, "executed", deleteBucketResult.stderr ?? deleteBucketResult.message);

    await assertBucketDeleted(bucket, env);
  } finally {
    process.chdir(previousCwd);
    await cleanupBucket(bucket, env);
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test("live Cloudflare CLI flow creates configures and undoes an R2 bucket", {
  skip: liveCloudflareEnabled ? false : liveCloudflareSkipReason,
  timeout: testTimeoutMs
}, async () => {
  const env = await requireCloudflareAuth();
  const name = `stacksmith-cli-r2-${projectSuffix()}`;
  const bucket = `${name}-dev`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-cli-r2-")), name);
  const cliPath = fileURLToPath(new URL("../cli.ts", import.meta.url));
  const stacksmithRoot = dirname(dirname(cliPath));
  const tsxLoaderPath = join(stacksmithRoot, "node_modules", "tsx", "dist", "loader.mjs");
  const manifestPath = join(root, ".stacksmith", "project.json");
  const statePath = join(root, ".stacksmith", "state.json");

  try {
    const create = await run(process.execPath, [
      "--import",
      tsxLoaderPath,
      cliPath,
      "create",
      name,
      root
    ], { cwd: stacksmithRoot, env });
    assert.equal(create.exitCode, 0, create.stderr);

    for (const id of ["cloudflare.r2.dev", "cloudflare.r2.cors.dev"]) {
      const apply = await run(process.execPath, [
        "--import",
        tsxLoaderPath,
        cliPath,
        "commands",
        "--provider",
        "cloudflare",
        "--id",
        id,
        "--manifest",
        manifestPath,
        "--state",
        statePath,
        "--execute"
      ], { cwd: root, env });
      assert.equal(apply.exitCode, 0, apply.stderr);
    }

    await assertBucketExists(bucket, env);
    await assertCorsConfigured(bucket, env);

    const undo = await run(process.execPath, [
      "--import",
      tsxLoaderPath,
      cliPath,
      "commands",
      "--provider",
      "cloudflare",
      "--id",
      "cloudflare.r2.dev",
      "--manifest",
      manifestPath,
      "--state",
      statePath,
      "--execute",
      "--undo"
    ], { cwd: root, env });
    assert.equal(undo.exitCode, 0, undo.stderr);

    await assertBucketDeleted(bucket, env);
  } finally {
    await cleanupBucket(bucket, env);
    await rm(dirname(root), { recursive: true, force: true });
  }
});
