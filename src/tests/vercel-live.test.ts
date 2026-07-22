import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import { runExternalCommand } from "../core/commands.js";
import { createProject } from "../core/create.js";
import { providerCommandPlan } from "../providers/command-plans.js";

const liveVercelEnabled = process.env.STACKSMITH_LIVE_VERCEL_TEST === "1";
const liveVercelSkipReason = "Set STACKSMITH_LIVE_VERCEL_TEST=1 to run live Vercel create/delete tests.";
const testTimeoutMs = 180_000;

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function projectSuffix(): string {
  return randomBytes(3).toString("hex");
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

async function assertVercelProjectExists(project: string): Promise<void> {
  const result = await run("vercel", ["project", "inspect", project]);
  assert.equal(result.exitCode, 0, result.stderr);
}

async function assertVercelProjectDeleted(project: string): Promise<void> {
  const result = await run("vercel", ["project", "inspect", project]);
  assert.notEqual(result.exitCode, 0, "Expected Vercel project to be deleted.");
}

async function cleanupVercelProject(project: string): Promise<void> {
  await run("sh", ["-c", `printf 'y\\n' | vercel project remove '${project.replace(/'/g, "'\\''")}'`]);
}

test("live Vercel command plan creates verifies deletes and verifies deletion", {
  skip: liveVercelEnabled ? false : liveVercelSkipReason,
  timeout: testTimeoutMs
}, async () => {
  const name = `stacksmith-live-vercel-${projectSuffix()}`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-live-vercel-")), name);
  const result = await createProject({ name, targetDir: root, force: true });
  const commands = providerCommandPlan("vercel", result.manifest)
    .filter((command) => command.id === "vercel.project.create");

  try {
    assert.equal(commands.length, 1);

    for (const command of commands) {
      const commandResult = await runExternalCommand({ command, execute: true });
      assert.notEqual(commandResult.status, "failed", commandResult.stderr ?? commandResult.message);
    }

    await assertVercelProjectExists(name);

    for (const command of [...commands].reverse()) {
      const commandResult = await runExternalCommand({ command, execute: true, mode: "undo" });
      assert.notEqual(commandResult.status, "failed", commandResult.stderr ?? commandResult.message);
    }

    await assertVercelProjectDeleted(name);
  } finally {
    await cleanupVercelProject(name);
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test("live Vercel e2e CLI flow creates verifies deletes and verifies deletion", {
  skip: liveVercelEnabled ? false : liveVercelSkipReason,
  timeout: testTimeoutMs
}, async () => {
  const name = `stacksmith-e2e-vercel-${projectSuffix()}`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-e2e-vercel-")), name);
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
      root,
      "--base-domain",
      "example.com",
      "--project-subdomain",
      name
    ], { cwd: stacksmithRoot });
    assert.equal(create.exitCode, 0, create.stderr);

    const apply = await run(process.execPath, [
      "--import",
      tsxLoaderPath,
      cliPath,
      "commands",
      "--provider",
      "vercel",
      "--id",
      "vercel.project.create",
      "--manifest",
      manifestPath,
      "--state",
      statePath,
      "--execute"
    ], { cwd: root });
    assert.equal(apply.exitCode, 0, apply.stderr);

    await assertVercelProjectExists(name);

    const undo = await run(process.execPath, [
      "--import",
      tsxLoaderPath,
      cliPath,
      "commands",
      "--provider",
      "vercel",
      "--id",
      "vercel.project.create",
      "--execute",
      "--undo",
      "--manifest",
      manifestPath,
      "--state",
      statePath
    ], { cwd: root });
    assert.equal(undo.exitCode, 0, undo.stderr);

    await assertVercelProjectDeleted(name);
    await assert.rejects(() => access(join(root, ".vercel")));
  } finally {
    await cleanupVercelProject(name);
    await rm(dirname(root), { recursive: true, force: true });
  }
});
