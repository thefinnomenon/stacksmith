import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import { runExternalCommand } from "../core/commands.js";
import { createProject } from "../core/create.js";
import { providerCommandPlan } from "../providers/command-plans.js";
import { parseVercelTeamsList } from "../providers/vercel-scope.js";

const liveStackEnabled = process.env.STACKSMITH_LIVE_STACK_TEST === "1";
const liveStackSkipReason = "Set STACKSMITH_LIVE_STACK_TEST=1 to run live GitHub -> Vercel -> Prisma e2e tests.";
const testTimeoutMs = 360_000;

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function projectSuffix(): string {
  return randomBytes(3).toString("hex");
}

function liveGitEnv(owner: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GITHUB_OWNER: owner,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "Stacksmith Test",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "stacksmith-test@example.invalid",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "Stacksmith Test",
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "stacksmith-test@example.invalid"
  };
}

async function run(command: string, args: string[], options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: ["ignore", "pipe", "pipe"]
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
  });
}

async function currentGithubOwner(): Promise<string> {
  if (process.env.STACKSMITH_TEST_GITHUB_OWNER) {
    return process.env.STACKSMITH_TEST_GITHUB_OWNER;
  }

  const result = await run("gh", ["api", "user", "--jq", ".login"]);
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
}

async function currentVercelScope(): Promise<string> {
  if (process.env.STACKSMITH_TEST_VERCEL_SCOPE) {
    return process.env.STACKSMITH_TEST_VERCEL_SCOPE;
  }

  const result = await run("vercel", ["teams", "list"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const scopes = parseVercelTeamsList(`${result.stdout}\n${result.stderr}`);
  const selected = scopes.find((scope) => scope.selected) ?? scopes[0];
  assert.ok(selected, "Could not infer Vercel scope. Set STACKSMITH_TEST_VERCEL_SCOPE.");
  return selected.id;
}

async function requireDeleteRepoScope(): Promise<void> {
  const result = await run("gh", ["auth", "status"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(
    output,
    /delete_repo/,
    "Live stack tests require GitHub delete_repo scope. Run `gh auth refresh -h github.com -s delete_repo`."
  );
}

async function assertRepoExists(repo: string): Promise<void> {
  const result = await run("gh", ["repo", "view", repo]);
  assert.equal(result.exitCode, 0, result.stderr);
}

async function assertRepoDeleted(repo: string): Promise<void> {
  const result = await run("gh", ["repo", "view", repo]);
  assert.notEqual(result.exitCode, 0, "Expected GitHub repository to be deleted.");
}

async function assertVercelProjectExists(project: string, scope: string): Promise<void> {
  const result = await run("vercel", ["project", "inspect", project, "--scope", scope]);
  assert.equal(result.exitCode, 0, result.stderr);
}

async function assertVercelProjectDeleted(project: string, scope: string): Promise<void> {
  const result = await run("vercel", ["project", "inspect", project, "--scope", scope]);
  assert.notEqual(result.exitCode, 0, "Expected Vercel project to be deleted.");
}

async function assertPrismaResourceConnected(project: string, resource: string, scope: string): Promise<void> {
  const result = await run("vercel", ["integration-resource", "inspect", resource, "--format=json", "--scope", scope]);
  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    resource?: {
      projects?: Array<{ name?: string }>;
    };
  };

  assert.ok(
    parsed.resource?.projects?.some((candidate) => candidate.name === project),
    `Expected ${resource} to be connected to ${project}.`
  );
}

async function assertPrismaResourceDeleted(resource: string, scope: string): Promise<void> {
  const result = await run("vercel", ["integration-resource", "inspect", resource, "--format=json", "--scope", scope]);
  assert.notEqual(result.exitCode, 0, "Expected Prisma Marketplace resource to be deleted.");
}

async function cleanup(repo: string, project: string, resource: string, scope: string): Promise<void> {
  await run("vercel", ["integration-resource", "remove", resource, "--disconnect-all", "--yes", "--format=json", "--scope", scope]);
  await run("sh", ["-c", `printf 'y\\n' | vercel project remove '${project.replace(/'/g, "'\\''")}' --scope '${scope.replace(/'/g, "'\\''")}'`]);
  await run("gh", ["repo", "delete", repo, "--yes"]);
}

test("live stack e2e creates GitHub repo, Vercel project, Prisma database and tears them down", {
  skip: liveStackEnabled ? false : liveStackSkipReason,
  timeout: testTimeoutMs
}, async () => {
  await requireDeleteRepoScope();
  const owner = await currentGithubOwner();
  const scope = await currentVercelScope();
  const name = `stacksmith-live-stack-${projectSuffix()}`;
  const repo = `${owner}/${name}`;
  const resource = `${name}-production-db`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-live-stack-")), name);
  const result = await createProject({ name, targetDir: root, force: true, vercelTeam: scope });
  result.manifest.providers.github.owner = owner;
  result.manifest.providers.github.private = true;
  const gitCommands = providerCommandPlan("github", result.manifest);
  const vercelCommands = providerCommandPlan("vercel", result.manifest)
    .filter((command) => command.id === "vercel.project.create");
  const prismaCommands = providerCommandPlan("prisma-postgres", result.manifest);
  const previousCwd = process.cwd();

  try {
    process.chdir(root);

    for (const command of gitCommands) {
      const commandResult = await runExternalCommand({ command, execute: true, env: liveGitEnv(owner) });
      assert.notEqual(commandResult.status, "failed", commandResult.stderr ?? commandResult.message);
    }
    await assertRepoExists(repo);

    for (const command of vercelCommands) {
      const commandResult = await runExternalCommand({ command, execute: true });
      assert.notEqual(commandResult.status, "failed", commandResult.stderr ?? commandResult.message);
    }
    await assertVercelProjectExists(name, scope);

    for (const command of prismaCommands) {
      const commandResult = await runExternalCommand({ command, execute: true });
      assert.notEqual(commandResult.status, "failed", commandResult.stderr ?? commandResult.message);
    }
    await assertPrismaResourceConnected(name, resource, scope);

    for (const command of [...prismaCommands].reverse()) {
      const commandResult = await runExternalCommand({ command, execute: true, mode: "undo" });
      assert.notEqual(commandResult.status, "failed", commandResult.stderr ?? commandResult.message);
    }
    await assertPrismaResourceDeleted(resource, scope);

    for (const command of [...vercelCommands].reverse()) {
      const commandResult = await runExternalCommand({ command, execute: true, mode: "undo" });
      assert.notEqual(commandResult.status, "failed", commandResult.stderr ?? commandResult.message);
    }
    await assertVercelProjectDeleted(name, scope);

    for (const command of [...gitCommands].reverse()) {
      const commandResult = await runExternalCommand({ command, execute: true, mode: "undo", env: liveGitEnv(owner) });
      assert.notEqual(commandResult.status, "failed", commandResult.stderr ?? commandResult.message);
    }
    await assertRepoDeleted(repo);
  } finally {
    process.chdir(previousCwd);
    await cleanup(repo, name, resource, scope);
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test("live stack CLI e2e applies GitHub Vercel Prisma and undoes them in reverse", {
  skip: liveStackEnabled ? false : liveStackSkipReason,
  timeout: testTimeoutMs
}, async () => {
  await requireDeleteRepoScope();
  const owner = await currentGithubOwner();
  const scope = await currentVercelScope();
  const name = `stacksmith-cli-stack-${projectSuffix()}`;
  const repo = `${owner}/${name}`;
  const resource = `${name}-production-db`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-cli-stack-")), name);
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
      name,
      "--vercel-team",
      scope
    ], { cwd: stacksmithRoot, env: liveGitEnv(owner) });
    assert.equal(create.exitCode, 0, create.stderr);

    const github = await run(process.execPath, [
      "--import",
      tsxLoaderPath,
      cliPath,
      "commands",
      "--provider",
      "github",
      "--manifest",
      manifestPath,
      "--state",
      statePath,
      "--execute"
    ], { cwd: root, env: liveGitEnv(owner) });
    assert.equal(github.exitCode, 0, github.stderr);
    await assertRepoExists(repo);

    const vercel = await run(process.execPath, [
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
    assert.equal(vercel.exitCode, 0, vercel.stderr);
    await assertVercelProjectExists(name, scope);

    const prisma = await run(process.execPath, [
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
    assert.equal(prisma.exitCode, 0, prisma.stderr);
    await assertPrismaResourceConnected(name, resource, scope);

    const undoPrisma = await run(process.execPath, [
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
      "--execute",
      "--undo"
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
      "--manifest",
      manifestPath,
      "--state",
      statePath,
      "--execute",
      "--undo"
    ], { cwd: root });
    assert.equal(undoVercel.exitCode, 0, undoVercel.stderr);
    await assertVercelProjectDeleted(name, scope);

    const undoGithub = await run(process.execPath, [
      "--import",
      tsxLoaderPath,
      cliPath,
      "commands",
      "--provider",
      "github",
      "--manifest",
      manifestPath,
      "--state",
      statePath,
      "--execute",
      "--undo"
    ], { cwd: root, env: liveGitEnv(owner) });
    assert.equal(undoGithub.exitCode, 0, undoGithub.stderr);
    await assertRepoDeleted(repo);
  } finally {
    await cleanup(repo, name, resource, scope);
    await rm(dirname(root), { recursive: true, force: true });
  }
});
