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

const liveGithubEnabled = process.env.STACKSMITH_LIVE_GITHUB_TEST === "1";
const liveGithubSkipReason = "Set STACKSMITH_LIVE_GITHUB_TEST=1 to run live GitHub create/delete tests.";
const testTimeoutMs = 180_000;

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function repoSuffix(): string {
  return randomBytes(4).toString("hex");
}

function liveEnv(owner?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(owner ? { GITHUB_OWNER: owner } : {}),
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

async function requireDeleteRepoScope(): Promise<void> {
  const result = await run("gh", ["auth", "status"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(
    output,
    /delete_repo/,
    "Live GitHub tests require the delete_repo scope so temporary repositories can be verified and deleted. Run `gh auth refresh -h github.com -s delete_repo`."
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

async function assertRemoteMainExists(repo: string): Promise<void> {
  const result = await run("gh", ["api", `repos/${repo}/git/ref/heads/main`, "--jq", ".ref"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.trim(), "refs/heads/main");
}

test("live GitHub command plan creates verifies pushes deletes and verifies deletion", {
  skip: liveGithubEnabled ? false : liveGithubSkipReason,
  timeout: testTimeoutMs
}, async () => {
  await requireDeleteRepoScope();
  const owner = await currentGithubOwner();
  const name = `stacksmith-live-gh-${repoSuffix()}`;
  const repo = `${owner}/${name}`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-live-gh-")), name);
  const result = await createProject({ name, targetDir: root, force: true });
  result.manifest.providers.github.owner = owner;
  const commands = providerCommandPlan("github", result.manifest);

  try {
    for (const command of commands) {
      const commandResult = await runExternalCommand({
        command,
        execute: true,
        env: liveEnv(owner)
      });
      assert.notEqual(commandResult.status, "failed", commandResult.stderr ?? commandResult.message);
    }

    await assertRepoExists(repo);
    await assertRemoteMainExists(repo);

    for (const command of [...commands].reverse()) {
      const commandResult = await runExternalCommand({
        command,
        execute: true,
        mode: "undo",
        env: liveEnv(owner)
      });
      assert.notEqual(commandResult.status, "failed", commandResult.stderr ?? commandResult.message);
    }

    await assertRepoDeleted(repo);
    await assert.rejects(() => access(join(root, ".git")));
  } finally {
    await run("gh", ["repo", "delete", repo, "--yes"]);
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test("live GitHub e2e CLI flow creates verifies pushes deletes and verifies deletion", {
  skip: liveGithubEnabled ? false : liveGithubSkipReason,
  timeout: testTimeoutMs
}, async () => {
  await requireDeleteRepoScope();
  const owner = await currentGithubOwner();
  const name = `stacksmith-e2e-gh-${repoSuffix()}`;
  const repo = `${owner}/${name}`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-e2e-gh-")), name);
  const cliPath = fileURLToPath(new URL("../cli.ts", import.meta.url));
  const stacksmithRoot = dirname(dirname(cliPath));
  const tsxLoaderPath = join(stacksmithRoot, "node_modules", "tsx", "dist", "loader.mjs");
  const manifestPath = join(root, ".stacksmith", "project.json");
  const statePath = join(root, ".stacksmith", "state.json");
  const env = liveEnv(owner);

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
    ], { cwd: stacksmithRoot, env });
    assert.equal(create.exitCode, 0, create.stderr);

    const apply = await run(process.execPath, [
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
    ], { cwd: root, env });
    assert.equal(apply.exitCode, 0, apply.stderr);

    await assertRepoExists(repo);
    await assertRemoteMainExists(repo);

    const undo = await run(process.execPath, [
      "--import",
      tsxLoaderPath,
      cliPath,
      "commands",
      "--provider",
      "github",
      "--execute",
      "--undo",
      "--manifest",
      manifestPath,
      "--state",
      statePath
    ], { cwd: root, env });
    assert.equal(undo.exitCode, 0, undo.stderr);

    await assertRepoDeleted(repo);
    await assert.rejects(() => access(join(root, ".git")));
  } finally {
    await run("gh", ["repo", "delete", repo, "--yes"]);
    await rm(dirname(root), { recursive: true, force: true });
  }
});
