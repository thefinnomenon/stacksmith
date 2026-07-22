import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import { runExternalCommand } from "../core/commands.js";
import { createProject } from "../core/create.js";
import type { ProjectManifest } from "../core/types.js";
import { providerCommandPlan } from "../providers/command-plans.js";

const livePrismaEnabled = process.env.STACKSMITH_LIVE_PRISMA_TEST === "1";
const livePrismaSkipReason = "Set STACKSMITH_LIVE_PRISMA_TEST=1 to run live Prisma Marketplace create/delete tests.";
const testTimeoutMs = 240_000;

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

async function currentVercelScope(): Promise<string> {
  if (process.env.STACKSMITH_TEST_VERCEL_SCOPE) {
    return process.env.STACKSMITH_TEST_VERCEL_SCOPE;
  }

  if (process.env.VERCEL_SCOPE) {
    return process.env.VERCEL_SCOPE;
  }

  const result = await run("vercel", ["teams", "list"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const selected = `${result.stdout}\n${result.stderr}`.match(/✔\s+([a-zA-Z0-9_-]+)/);
  assert.ok(selected?.[1], "Could not infer selected Vercel scope. Set STACKSMITH_TEST_VERCEL_SCOPE.");
  return selected[1];
}

async function assertVercelProjectDeleted(project: string, scope: string): Promise<void> {
  const result = await run("vercel", ["project", "inspect", project, "--scope", scope]);
  assert.notEqual(result.exitCode, 0, "Expected Vercel project to be deleted.");
}

async function assertPrismaResourceExists(resource: string, scope: string): Promise<void> {
  const result = await run("vercel", ["integration-resource", "inspect", resource, "--format=json", "--scope", scope]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, new RegExp(resource));
}

async function assertPrismaResourceDeleted(resource: string, scope: string): Promise<void> {
  const result = await run("vercel", ["integration-resource", "inspect", resource, "--format=json", "--scope", scope]);
  assert.notEqual(result.exitCode, 0, "Expected Prisma Marketplace resource to be deleted.");
}

async function assertPrismaResourceConnected(project: string, resource: string, scope: string): Promise<void> {
  const result = await run("vercel", ["integration-resource", "inspect", resource, "--format=json", "--scope", scope]);
  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    resource?: {
      projects?: Array<{
        name?: string;
        environments?: string[];
      }>;
    };
  };
  const connection = parsed.resource?.projects?.find((candidate) => candidate.name === project);
  assert.ok(connection, `Expected ${resource} to be connected to ${project}.`);
  assert.deepEqual(connection.environments?.sort(), ["development", "preview", "production"]);
}

async function cleanupVercelProject(project: string, scope: string): Promise<void> {
  await run("sh", ["-c", `printf 'y\\n' | vercel project remove '${project.replace(/'/g, "'\\''")}' --scope '${scope.replace(/'/g, "'\\''")}'`]);
}

async function cleanupPrismaResource(resource: string, scope: string): Promise<void> {
  await run("vercel", ["integration-resource", "remove", resource, "--disconnect-all", "--yes", "--format=json", "--scope", scope]);
}

async function setManifestVercelScope(path: string, scope: string): Promise<void> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as ProjectManifest;
  manifest.providers.vercel.team = scope;
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
}

test("live Prisma command plan creates connects deletes and verifies deletion", {
  skip: livePrismaEnabled ? false : livePrismaSkipReason,
  timeout: testTimeoutMs
}, async () => {
  const scope = await currentVercelScope();
  const name = `stacksmith-live-prisma-${projectSuffix()}`;
  const resource = `${name}-production-db`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-live-prisma-")), name);
  const result = await createProject({ name, targetDir: root, force: true });
  result.manifest.providers.vercel.team = scope;
  const createProjectCommand = providerCommandPlan("vercel", result.manifest)
    .find((command) => command.id === "vercel.project.create");
  const prismaCommands = providerCommandPlan("prisma-postgres", result.manifest);
  const previousCwd = process.cwd();

  try {
    assert.ok(createProjectCommand);
    const projectResult = await runExternalCommand({ command: createProjectCommand, execute: true });
    assert.notEqual(projectResult.status, "failed", projectResult.stderr ?? projectResult.message);

    process.chdir(root);
    for (const command of prismaCommands) {
      const commandResult = await runExternalCommand({ command, execute: true });
      assert.notEqual(commandResult.status, "failed", commandResult.stderr ?? commandResult.message);
    }

    await assertPrismaResourceExists(resource, scope);
    await assertPrismaResourceConnected(name, resource, scope);

    for (const command of [...prismaCommands].reverse()) {
      const commandResult = await runExternalCommand({ command, execute: true, mode: "undo" });
      assert.notEqual(commandResult.status, "failed", commandResult.stderr ?? commandResult.message);
    }

    await assertPrismaResourceDeleted(resource, scope);
  } finally {
    process.chdir(previousCwd);
    await cleanupPrismaResource(resource, scope);
    await cleanupVercelProject(name, scope);
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test("live Prisma e2e CLI flow creates connects deletes and verifies deletion", {
  skip: livePrismaEnabled ? false : livePrismaSkipReason,
  timeout: testTimeoutMs
}, async () => {
  const scope = await currentVercelScope();
  const name = `stacksmith-e2e-prisma-${projectSuffix()}`;
  const resource = `${name}-production-db`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-e2e-prisma-")), name);
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
    await setManifestVercelScope(manifestPath, scope);

    const createVercel = await run(process.execPath, [
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
    assert.equal(createVercel.exitCode, 0, createVercel.stderr);

    const createPrisma = await run(process.execPath, [
      "--import",
      tsxLoaderPath,
      cliPath,
      "commands",
      "--provider",
      "prisma-postgres",
      "--manifest",
      manifestPath,
      "--state",
      statePath,
      "--execute"
    ], { cwd: root });
    assert.equal(createPrisma.exitCode, 0, createPrisma.stderr);

    await assertPrismaResourceExists(resource, scope);
    await assertPrismaResourceConnected(name, resource, scope);

    const undoPrisma = await run(process.execPath, [
      "--import",
      tsxLoaderPath,
      cliPath,
      "commands",
      "--provider",
      "prisma-postgres",
      "--execute",
      "--undo",
      "--manifest",
      manifestPath,
      "--state",
      statePath
    ], { cwd: root });
    assert.equal(undoPrisma.exitCode, 0, undoPrisma.stderr);

    await assertPrismaResourceDeleted(resource, scope);

    const undoVercel = await run(process.execPath, [
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
    assert.equal(undoVercel.exitCode, 0, undoVercel.stderr);

    await assertVercelProjectDeleted(name, scope);
  } finally {
    await cleanupPrismaResource(resource, scope);
    await cleanupVercelProject(name, scope);
    await rm(dirname(root), { recursive: true, force: true });
  }
});
