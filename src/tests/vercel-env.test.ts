import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDefaultManifest } from "../core/defaults.js";
import {
  deleteVercelR2Env,
  listVercelEnvNames,
  parseEnvFile,
  parseVercelEnvListNames,
  r2VercelEnvKeys,
  requiredR2EnvValues,
  syncVercelR2Env,
  vercelTargetForEnvironment,
  type CommandRunner
} from "../providers/vercel-env.js";

function r2EnvContent(): string {
  return [
    "R2_ACCOUNT_ID=test-account",
    "R2_ACCESS_KEY_ID=test-access-key",
    "R2_SECRET_ACCESS_KEY=\"secret value\"",
    "R2_BUCKET_NAME=test-bucket",
    "R2_ENDPOINT=https://test-account.r2.cloudflarestorage.com",
    "FILES_URL=https://files.example.com",
    "R2_PREFIX="
  ].join("\n");
}

test("vercelTargetForEnvironment maps Stacksmith environments to Vercel targets", () => {
  assert.deepEqual(vercelTargetForEnvironment("development"), {
    stacksmithEnvironment: "development",
    vercelEnvironment: "development"
  });
  assert.deepEqual(vercelTargetForEnvironment("preview"), {
    stacksmithEnvironment: "preview",
    vercelEnvironment: "preview",
    gitBranch: undefined
  });
  assert.deepEqual(vercelTargetForEnvironment("staging"), {
    stacksmithEnvironment: "staging",
    vercelEnvironment: "preview",
    gitBranch: "staging"
  });
  assert.deepEqual(vercelTargetForEnvironment("production"), {
    stacksmithEnvironment: "production",
    vercelEnvironment: "production"
  });
});

test("parseEnvFile reads simple and quoted values", () => {
  assert.deepEqual(parseEnvFile(`APP_URL=http://localhost:3000
# comment
R2_SECRET_ACCESS_KEY="secret value"
R2_PREFIX=
IGNORED line
`), {
    APP_URL: "http://localhost:3000",
    R2_SECRET_ACCESS_KEY: "secret value",
    R2_PREFIX: ""
  });
});

test("requiredR2EnvValues reports missing keys", () => {
  assert.throws(
    () => requiredR2EnvValues(parseEnvFile("R2_ACCOUNT_ID=test-account\n")),
    /Missing R2 env value\(s\): R2_ACCESS_KEY_ID/
  );
});

test("parseVercelEnvListNames accepts common Vercel JSON shapes", () => {
  assert.deepEqual(parseVercelEnvListNames(JSON.stringify([{ key: "R2_ACCOUNT_ID" }, { key: "R2_BUCKET_NAME" }])), [
    "R2_ACCOUNT_ID",
    "R2_BUCKET_NAME"
  ]);
  assert.deepEqual(parseVercelEnvListNames(JSON.stringify({ envs: [{ name: "FILES_URL" }] })), ["FILES_URL"]);
  assert.deepEqual(parseVercelEnvListNames(JSON.stringify({ items: ["R2_PREFIX"] })), ["R2_PREFIX"]);
});

test("syncVercelR2Env dry run does not read env file or call Vercel", async () => {
  const manifest = createDefaultManifest({ name: "Face Reel", domain: "facereel.com" });
  const result = await syncVercelR2Env({
    manifest,
    environment: "development",
    envPath: "/missing/.env.local"
  });

  assert.equal(result.status, "planned");
  assert.equal(result.project, "face-reel");
  assert.deepEqual(result.keys, r2VercelEnvKeys);
});

test("syncVercelR2Env writes values over stdin without putting secrets in args", async () => {
  const root = await mkdtemp(join(tmpdir(), "stacksmith-vercel-env-"));
  const envPath = join(root, ".env.local");
  const manifest = createDefaultManifest({ name: "Face Reel", domain: "facereel.com", vercelTeam: "team-slug" });
  const calls: Array<{ command: string; args: string[]; stdin?: string }> = [];
  const runner: CommandRunner = async (command, args, options) => {
    calls.push({ command, args, stdin: options?.stdin });
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  try {
    await writeFile(envPath, `${r2EnvContent()}\n`);
    const result = await syncVercelR2Env({
      manifest,
      environment: "staging",
      envPath,
      execute: true,
      project: "custom-project",
      runner
    });

    assert.equal(result.status, "synced");
    assert.equal(calls.length, r2VercelEnvKeys.length);
    assert.deepEqual(calls[0], {
      command: "vercel",
      args: [
        "env",
        "add",
        "R2_ACCOUNT_ID",
        "preview",
        "staging",
        "--project",
        "custom-project",
        "--force",
        "--yes",
        "--scope",
        "team-slug"
      ],
      stdin: "test-account\n"
    });
    const secretCall = calls.find((call) => call.args.includes("R2_SECRET_ACCESS_KEY"));
    assert.ok(secretCall);
    assert.equal(secretCall.stdin, "secret value\n");
    assert.equal(secretCall.args.includes("secret value"), false);
    assert.equal(secretCall.args.includes("--sensitive"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deleteVercelR2Env removes every key and tolerates already absent values", async () => {
  const manifest = createDefaultManifest({ name: "Face Reel", domain: "facereel.com" });
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Environment Variable not found"
    };
  };

  const result = await deleteVercelR2Env({
    manifest,
    environment: "production",
    execute: true,
    scope: "team-slug",
    runner
  });

  assert.equal(result.status, "deleted");
  assert.equal(calls.length, r2VercelEnvKeys.length);
  assert.deepEqual(calls[0], [
    "env",
    "remove",
    "R2_ACCOUNT_ID",
    "production",
    "--project",
    "face-reel",
    "--yes",
    "--scope",
    "team-slug"
  ]);
});

test("listVercelEnvNames passes target project, scope, and branch", async () => {
  const manifest = createDefaultManifest({ name: "Face Reel", domain: "facereel.com" });
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    return {
      exitCode: 0,
      stdout: JSON.stringify([{ key: "R2_ACCOUNT_ID" }]),
      stderr: ""
    };
  };

  const names = await listVercelEnvNames({
    manifest,
    environment: "staging",
    project: "custom-project",
    scope: "team-slug",
    runner
  });

  assert.deepEqual(names, ["R2_ACCOUNT_ID"]);
  assert.deepEqual(calls[0], [
    "env",
    "list",
    "preview",
    "staging",
    "--project",
    "custom-project",
    "--format",
    "json",
    "--scope",
    "team-slug"
  ]);
});
