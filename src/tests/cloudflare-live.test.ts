import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { runExternalCommand } from "../core/commands.js";
import { createProject } from "../core/create.js";
import {
  createR2Credentials,
  defaultStacksmithEnvFile,
  deleteCloudflareApiToken,
  inferCloudflareAccountId
} from "../providers/cloudflare-r2-credentials.js";
import { providerCommandPlan } from "../providers/command-plans.js";

const liveCloudflareEnabled = process.env.STACKSMITH_LIVE_CLOUDFLARE_TEST === "1";
const liveCloudflareSkipReason = "Set STACKSMITH_LIVE_CLOUDFLARE_TEST=1 to run live Cloudflare R2 and Queue tests with the local Wrangler login.";
const liveR2CredentialsEnabled = process.env.STACKSMITH_LIVE_CLOUDFLARE_R2_CREDENTIALS_TEST === "1";
const liveR2CredentialsSkipReason = "Set STACKSMITH_LIVE_CLOUDFLARE_R2_CREDENTIALS_TEST=1 and CLOUDFLARE_API_TOKEN with API Tokens Write to run live R2 credential tests.";
const liveR2EventDeliveryEnabled = process.env.STACKSMITH_LIVE_R2_EVENT_DELIVERY_TEST === "1";
const liveR2EventDeliverySkipReason = "Set STACKSMITH_LIVE_R2_EVENT_DELIVERY_TEST=1 with Vercel auth and Cloudflare token access to run live R2 event delivery tests.";
const testTimeoutMs = 240_000;
const deliveryTestTimeoutMs = 600_000;

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

async function assertQueueExists(queue: string, env: NodeJS.ProcessEnv): Promise<void> {
  const result = await run("wrangler", ["queues", "info", queue], { env });
  assert.equal(result.exitCode, 0, result.stderr);
}

async function assertQueueDeleted(queue: string, env: NodeJS.ProcessEnv): Promise<void> {
  const result = await run("wrangler", ["queues", "info", queue], { env });
  assert.notEqual(result.exitCode, 0, "Expected Cloudflare Queue to be deleted.");
}

async function assertCorsConfigured(bucket: string, env: NodeJS.ProcessEnv): Promise<void> {
  const result = await run("wrangler", ["r2", "bucket", "cors", "list", bucket], { env });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /allowed/i);
  assert.match(result.stdout, /localhost:3000|vercel\.app/i);
}

async function assertNotificationRuleExists(bucket: string, queue: string, env: NodeJS.ProcessEnv): Promise<void> {
  const result = await run("wrangler", ["r2", "bucket", "notification", "list", bucket], { env });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, new RegExp(queue));
  assert.match(result.stdout, /PutObject|CompleteMultipartUpload|CopyObject/i);
  assert.match(result.stdout, /DeleteObject|LifecycleDeletion/i);
}

async function cleanupBucket(bucket: string, env: NodeJS.ProcessEnv): Promise<void> {
  await run("wrangler", ["r2", "bucket", "delete", bucket], { env, stdin: "y\n" });
}

async function cleanupQueue(queue: string, env: NodeJS.ProcessEnv): Promise<void> {
  await run("wrangler", ["queues", "delete", queue], { env, stdin: "y\n" });
}

async function cleanupWorker(worker: string, env: NodeJS.ProcessEnv): Promise<void> {
  await run("wrangler", ["delete", worker], { env, stdin: "y\n" });
}

async function cleanupVercelProject(project: string): Promise<void> {
  await run("sh", ["-c", `printf 'y\\n' | vercel project remove '${project.replace(/'/g, "'\\''")}'`]);
}

async function waitForNotificationRuleDeleted(bucket: string, queue: string, env: NodeJS.ProcessEnv): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await run("wrangler", ["r2", "bucket", "notification", "list", bucket], { env });
    if (result.exitCode !== 0 || !result.stdout.includes(queue)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  assert.fail(`Expected R2 notification rule for ${queue} on ${bucket} to be deleted.`);
}

async function cleanupNotification(bucket: string, queue: string, env: NodeJS.ProcessEnv): Promise<void> {
  await run("wrangler", ["r2", "bucket", "notification", "delete", bucket, "--queue", queue], { env });
  await waitForNotificationRuleDeleted(bucket, queue, env);
}

async function addVercelProductionEnv(project: string, key: string, value: string, sensitive = false): Promise<void> {
  const result = await run("vercel", [
    "env",
    "add",
    key,
    "production",
    "--project",
    project,
    "--force",
    "--yes",
    ...(sensitive ? ["--sensitive"] : [])
  ], { stdin: `${value}\n` });

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
}

function parseVercelDeploymentUrl(stdout: string): string {
  const matches = stdout.match(/https:\/\/[^\s"']+/g) ?? [];
  const url = matches.find((candidate) => candidate.includes(".vercel.app")) ?? matches.at(-1);
  assert.ok(url, `Unable to parse Vercel deployment URL from output:\n${stdout}`);
  return url.replace(/[),.]+$/, "");
}

async function waitForHttpOk(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `${response.status} ${await response.text()}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  assert.fail(`Expected ${url} to become healthy. Last error: ${lastError}`);
}

async function waitForR2JsonObject(bucket: string, key: string, env: NodeJS.ProcessEnv, timeoutMs = 300_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    const result = await run("wrangler", ["r2", "object", "get", `${bucket}/${key}`, "--remote", "--pipe"], { env });
    if (result.exitCode === 0) {
      return JSON.parse(result.stdout) as unknown;
    }

    lastError = result.stderr || result.stdout;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  assert.fail(`Expected R2 object ${bucket}/${key}. Last error: ${lastError}`);
}

async function postSignedR2Envelope(url: string, secret: string, envelope: unknown): Promise<unknown> {
  const body = JSON.stringify(envelope);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-stacksmith-event": "cloudflare-r2",
      "x-stacksmith-timestamp": timestamp,
      "x-stacksmith-signature": signature
    },
    body
  });

  const responseText = await response.text();
  assert.equal(response.ok, true, `Expected ${url} to accept signed R2 event envelope. ${response.status} ${responseText}`);
  return JSON.parse(responseText) as unknown;
}

async function readLocalEnvValue(path: string, key: string): Promise<string | undefined> {
  const content = await readFile(path, "utf8").catch(() => "");
  for (const line of content.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && line.slice(0, index) === key) {
      return line.slice(index + 1);
    }
  }

  return undefined;
}

async function createCloudflareDeliveryToken(name: string): Promise<{ tokenId: string; tokenValue: string }> {
  const accountId = await inferCloudflareAccountId();
  const parentToken = process.env.CLOUDFLARE_API_TOKEN ?? await readLocalEnvValue(defaultStacksmithEnvFile(), "CLOUDFLARE_API_TOKEN");
  assert.ok(parentToken, "Set CLOUDFLARE_API_TOKEN or save it with `stacksmith cloudflare setup-token --save --execute`.");

  const permissionGroupsResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/permission_groups`,
    { headers: { Authorization: `Bearer ${parentToken}` } }
  );
  const permissionGroupsJson = await permissionGroupsResponse.json() as {
    success: boolean;
    result?: Array<{ id: string; name?: string }>;
    errors?: Array<{ message?: string }>;
  };
  assert.equal(permissionGroupsJson.success, true, JSON.stringify(permissionGroupsJson.errors ?? []));

  const permissionGroupsByName = new Map((permissionGroupsJson.result ?? []).map((group) => [group.name, group.id]));
  const requiredPermissionNames = [
    "Queues Read",
    "Queues Write",
    "Workers Scripts Read",
    "Workers Scripts Write",
    "Workers R2 Storage Read",
    "Workers R2 Storage Write",
    "Workers R2 Storage Bucket Item Read",
    "Workers R2 Storage Bucket Item Write"
  ];
  const permissionGroups = requiredPermissionNames.map((permissionName) => {
    const id = permissionGroupsByName.get(permissionName);
    assert.ok(id, `Cloudflare permission group not found: ${permissionName}`);
    return { id, meta: {} };
  });

  const createResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${parentToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: `stacksmith-${name}-delivery-${projectSuffix()}`,
      policies: [
        {
          effect: "allow",
          permission_groups: permissionGroups,
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: "*"
          }
        }
      ]
    })
  });
  const createJson = await createResponse.json() as {
    success: boolean;
    result?: { id?: string; value?: string };
    errors?: Array<{ message?: string }>;
  };

  assert.equal(createJson.success, true, JSON.stringify(createJson.errors ?? []));
  assert.ok(createJson.result?.id, "Cloudflare did not return a token id.");
  assert.ok(createJson.result.value, "Cloudflare did not return the one-time token value.");

  return {
    tokenId: createJson.result.id,
    tokenValue: createJson.result.value
  };
}

async function hasWorkersSubdomain(t: TestContext, env: NodeJS.ProcessEnv): Promise<boolean> {
  const accountId = await inferCloudflareAccountId();
  const token = env.CLOUDFLARE_API_TOKEN ?? await readLocalEnvValue(defaultStacksmithEnvFile(), "CLOUDFLARE_API_TOKEN");
  assert.ok(token, "Set CLOUDFLARE_API_TOKEN or save it with `stacksmith cloudflare setup-token --save --execute`.");

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await response.json().catch(() => undefined) as {
    success?: boolean;
    result?: { subdomain?: string };
    errors?: Array<{ code?: number; message?: string }>;
  } | undefined;

  if (response.ok && body?.success && body.result?.subdomain) {
    return true;
  }

  const reason = body?.errors?.map((error) => `${error.code ?? "unknown"} ${error.message ?? ""}`.trim()).join("; ");
  t.skip([
    "Cloudflare account needs a workers.dev subdomain before Worker Queue consumers can be created.",
    "Open the Cloudflare Dashboard > Workers & Pages once to initialize it, then rerun this live test.",
    reason ? `Cloudflare response: ${reason}` : undefined
  ].filter(Boolean).join(" "));
  return false;
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

test("live Cloudflare command plan creates verifies and deletes an R2 event queue", {
  skip: liveCloudflareEnabled ? false : liveCloudflareSkipReason,
  timeout: testTimeoutMs
}, async () => {
  const env = await requireCloudflareAuth();
  const name = `stacksmith-live-queue-${projectSuffix()}`;
  const queue = `${name}-r2-events`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-live-queue-")), name);
  const result = await createProject({ name, targetDir: root, force: true });
  const command = providerCommandPlan("cloudflare", result.manifest)
    .find((candidate) => candidate.id === "cloudflare.r2.events.queue");

  try {
    assert.ok(command);
    const createQueueResult = await runExternalCommand({ command, execute: true, env });
    assert.equal(createQueueResult.status, "executed", createQueueResult.stderr ?? createQueueResult.message);

    await assertQueueExists(queue, env);

    const deleteQueueResult = await runExternalCommand({ command, execute: true, mode: "undo", env });
    assert.equal(deleteQueueResult.status, "executed", deleteQueueResult.stderr ?? deleteQueueResult.message);

    await assertQueueDeleted(queue, env);
  } finally {
    await cleanupQueue(queue, env);
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test("live Cloudflare command plan wires R2 bucket notifications to a queue", {
  skip: liveCloudflareEnabled ? false : liveCloudflareSkipReason,
  timeout: testTimeoutMs
}, async () => {
  const env = await requireCloudflareAuth();
  const name = `stacksmith-live-r2-events-${projectSuffix()}`;
  const bucket = `${name}-dev`;
  const queue = `${name}-r2-events`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-live-r2-events-")), name);
  const result = await createProject({ name, targetDir: root, force: true });
  const commands = providerCommandPlan("cloudflare", result.manifest);
  const createBucket = commands.find((command) => command.id === "cloudflare.r2.dev");
  const createQueue = commands.find((command) => command.id === "cloudflare.r2.events.queue");
  const createNotification = commands.find((command) => command.id === "cloudflare.r2.events.notification.dev");

  try {
    assert.ok(createBucket);
    assert.ok(createQueue);
    assert.ok(createNotification);

    for (const command of [createBucket, createQueue, createNotification]) {
      const commandResult = await runExternalCommand({ command, execute: true, env });
      assert.equal(commandResult.status, "executed", commandResult.stderr ?? commandResult.message);
    }

    await assertBucketExists(bucket, env);
    await assertQueueExists(queue, env);
    await assertNotificationRuleExists(bucket, queue, env);

    const deleteNotification = await runExternalCommand({ command: createNotification, execute: true, mode: "undo", env });
    assert.equal(deleteNotification.status, "executed", deleteNotification.stderr ?? deleteNotification.message);
    await waitForNotificationRuleDeleted(bucket, queue, env);

    const deleteQueue = await runExternalCommand({ command: createQueue, execute: true, mode: "undo", env });
    assert.equal(deleteQueue.status, "executed", deleteQueue.stderr ?? deleteQueue.message);

    const deleteBucket = await runExternalCommand({ command: createBucket, execute: true, mode: "undo", env });
    assert.equal(deleteBucket.status, "executed", deleteBucket.stderr ?? deleteBucket.message);

    await assertQueueDeleted(queue, env);
    await assertBucketDeleted(bucket, env);
  } finally {
    await cleanupNotification(bucket, queue, env);
    await cleanupBucket(bucket, env);
    await cleanupQueue(queue, env);
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

test("live R2 event delivery uploads and deletes an object and verifies Vercel webhook markers", {
  skip: liveR2EventDeliveryEnabled ? false : liveR2EventDeliverySkipReason,
  timeout: deliveryTestTimeoutMs
}, async (t) => {
  const env = await requireCloudflareAuth();
  const name = `stacksmith-r2-event-e2e-${projectSuffix()}`;
  const sourceBucket = `${name}-dev`;
  const markerBucket = `${name}-markers`;
  const queue = `${name}-r2-events`;
  const deadLetterQueue = `${queue}-dead`;
  const worker = `${name}-r2-event-forwarder`;
  const markerPrefix = `markers/${projectSuffix()}/`;
  const objectKey = "uploads/e2e-object.txt";
  const directWebhookObjectKey = "uploads/direct-webhook-check.txt";
  let effectiveMarkerPrefix = markerPrefix;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-r2-event-delivery-")), name);
  const markerEnvFile = join(root, ".env.r2-marker.local");
  const objectFile = join(root, "e2e-object.txt");
  const cliPath = fileURLToPath(new URL("../cli.ts", import.meta.url));
  const stacksmithRoot = dirname(dirname(cliPath));
  const tsxLoaderPath = join(stacksmithRoot, "node_modules", "tsx", "dist", "loader.mjs");
  const manifestPath = join(root, ".stacksmith", "project.json");
  const statePath = join(root, ".stacksmith", "state.json");
  const webhookSecret = randomBytes(24).toString("hex");
  const projectUrl = `https://${name}.vercel.app`;
  let markerTokenId: string | undefined;
  let deliveryTokenId: string | undefined;
  let cloudflareEnv = env;
  const previousCwd = process.cwd();

  try {
    const deliveryToken = await createCloudflareDeliveryToken(name);
    deliveryTokenId = deliveryToken.tokenId;
    cloudflareEnv = {
      ...env,
      CLOUDFLARE_API_TOKEN: deliveryToken.tokenValue
    };
    if (!await hasWorkersSubdomain(t, cloudflareEnv)) {
      return;
    }

    const result = await createProject({ name, targetDir: root, force: true });
    const cloudflareCommands = providerCommandPlan("cloudflare", result.manifest);
    const vercelCommands = providerCommandPlan("vercel", result.manifest);
    const createVercelProject = vercelCommands.find((command) => command.id === "vercel.project.create");
    const configureVercelNext = vercelCommands.find((command) => command.id === "vercel.project.configure-next");
    const createSourceBucket = cloudflareCommands.find((command) => command.id === "cloudflare.r2.dev");
    const createQueue = cloudflareCommands.find((command) => command.id === "cloudflare.r2.events.queue");
    const createDeadLetterQueue = cloudflareCommands.find((command) => command.id === "cloudflare.r2.events.dead-letter-queue");
    const deployWorker = cloudflareCommands.find((command) => command.id === "cloudflare.r2.events.worker.deploy");
    const setWorkerSecret = cloudflareCommands.find((command) => command.id === "cloudflare.r2.events.worker.secret");
    const createNotification = cloudflareCommands.find((command) => command.id === "cloudflare.r2.events.notification.dev");
    assert.ok(createVercelProject);
    assert.ok(configureVercelNext);
    assert.ok(createSourceBucket);
    assert.ok(createQueue);
    assert.ok(createDeadLetterQueue);
    assert.ok(deployWorker);
    assert.ok(setWorkerSecret);
    assert.ok(createNotification);

    const createVercel = await runExternalCommand({ command: createVercelProject, execute: true });
    assert.notEqual(createVercel.status, "failed", createVercel.stderr ?? createVercel.message);
    const configureNext = await runExternalCommand({ command: configureVercelNext, execute: true });
    assert.notEqual(configureNext.status, "failed", configureNext.stderr ?? configureNext.message);

    process.chdir(root);

    for (const command of [createSourceBucket, createQueue, createDeadLetterQueue]) {
      const commandResult = await runExternalCommand({ command, execute: true, env: cloudflareEnv });
      assert.equal(commandResult.status, "executed", commandResult.stderr ?? commandResult.message);
    }

    const createMarkerBucket = await run("wrangler", ["r2", "bucket", "create", markerBucket], { env: cloudflareEnv });
    assert.equal(createMarkerBucket.exitCode, 0, createMarkerBucket.stderr);

    const credentials = await createR2Credentials({
      manifest: result.manifest,
      environment: "development",
      bucketName: markerBucket,
      envFile: markerEnvFile,
      filesUrl: "https://files.example.com",
      prefix: markerPrefix,
      execute: true
    });
    markerTokenId = credentials.tokenId;
    assert.equal(credentials.status, "configured");
    assert.ok(markerTokenId);

    const syncR2Env = await run(process.execPath, [
      "--import",
      tsxLoaderPath,
      cliPath,
      "vercel",
      "env",
      "sync-r2",
      "--manifest",
      manifestPath,
      "--state",
      statePath,
      "--environment",
      "production",
      "--from-env-path",
      markerEnvFile,
      "--execute"
    ], { cwd: root });
    assert.equal(syncR2Env.exitCode, 0, syncR2Env.stderr);

    for (const [key, value, sensitive] of [
      ["STACKSMITH_PROJECT", name, false],
      ["APP_ENV", "production", false],
      ["APP_URL", projectUrl, false],
      ["AUTH_CALLBACK_URL", `${projectUrl}/api/auth/callback`, false],
      ["EMAIL_LINK_BASE_URL", projectUrl, false],
      ["STRIPE_WEBHOOK_URL", `${projectUrl}/webhooks/stripe`, false],
      ["DATABASE_URL", "postgresql://user:password@localhost:5432/stacksmith_e2e", true],
      ["R2_EVENT_WEBHOOK_SECRET", webhookSecret, true],
      ["STACKSMITH_R2_EVENT_E2E_MARKERS", "1", false]
    ] as const) {
      await addVercelProductionEnv(name, key, value, sensitive);
    }

    const deployment = await run("vercel", [
      "deploy",
      root,
      "--prod",
      "--yes",
      "--project",
      name
    ], { cwd: root });
    assert.equal(deployment.exitCode, 0, deployment.stderr || deployment.stdout);
    const deploymentUrl = parseVercelDeploymentUrl(deployment.stdout);
    await waitForHttpOk(`${deploymentUrl}/api/health`);
    await waitForHttpOk(`${projectUrl}/api/health`);
    const directWebhookResult = await postSignedR2Envelope(`${projectUrl}/api/webhook/cloudflare/r2`, webhookSecret, {
      project: name,
      source: "cloudflare-r2",
      receivedAt: new Date().toISOString(),
      events: [
        {
          account: await inferCloudflareAccountId(),
          action: "PutObject",
          bucket: sourceBucket,
          object: {
            key: directWebhookObjectKey,
            size: 1,
            eTag: "direct-webhook-check"
          },
          eventTime: new Date().toISOString()
        }
      ]
    });
    const directWebhookMarkers = (directWebhookResult as { markers?: string[] }).markers ?? [];
    const directWebhookMarkerKey = directWebhookMarkers.find((marker) => marker.endsWith(`PutObject/${sourceBucket}/${directWebhookObjectKey}.json`));
    assert.ok(directWebhookMarkerKey, `Expected direct webhook response to include marker for ${directWebhookObjectKey}. Response: ${JSON.stringify(directWebhookResult)}`);
    effectiveMarkerPrefix = directWebhookMarkerKey.slice(0, directWebhookMarkerKey.indexOf("PutObject/"));
    await waitForR2JsonObject(markerBucket, directWebhookMarkerKey, cloudflareEnv);

    const workerConfigPath = join(root, "workers", "r2-event-forwarder", "wrangler.jsonc");
    const workerConfig = JSON.parse(await readFile(workerConfigPath, "utf8")) as {
      vars?: Record<string, string>;
    };
    workerConfig.vars = {
      ...workerConfig.vars,
      R2_EVENT_FORWARD_URL: `${projectUrl}/api/webhook/cloudflare/r2`
    };
    await writeFile(workerConfigPath, `${JSON.stringify(workerConfig, null, 2)}\n`);

    const workerDeploy = await runExternalCommand({ command: deployWorker, execute: true, env: cloudflareEnv });
    assert.equal(workerDeploy.status, "executed", workerDeploy.stderr ?? workerDeploy.message);
    const workerSecret = await runExternalCommand({
      command: setWorkerSecret,
      execute: true,
      env: { ...cloudflareEnv, R2_EVENT_WEBHOOK_SECRET: webhookSecret }
    });
    assert.equal(workerSecret.status, "executed", workerSecret.stderr ?? workerSecret.message);
    const notification = await runExternalCommand({ command: createNotification, execute: true, env: cloudflareEnv });
    assert.equal(notification.status, "executed", notification.stderr ?? notification.message);

    await assertNotificationRuleExists(sourceBucket, queue, cloudflareEnv);
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    await writeFile(objectFile, "hello from Stacksmith R2 event e2e\n");

    const put = await run("wrangler", [
      "r2",
      "object",
      "put",
      `${sourceBucket}/${objectKey}`,
      "--remote",
      "--file",
      objectFile,
      "--content-type",
      "text/plain"
    ], { env: cloudflareEnv });
    assert.equal(put.exitCode, 0, put.stderr);

    const putMarkerKey = `${effectiveMarkerPrefix}PutObject/${sourceBucket}/${objectKey}.json`;
    const putMarker = await waitForR2JsonObject(markerBucket, putMarkerKey, cloudflareEnv);
    assert.equal((putMarker as { event?: { action?: string } }).event?.action, "PutObject");
    assert.equal((putMarker as { event?: { object?: { key?: string } } }).event?.object?.key, objectKey);

    const deleted = await run("wrangler", ["r2", "object", "delete", `${sourceBucket}/${objectKey}`, "--remote"], { env: cloudflareEnv });
    assert.equal(deleted.exitCode, 0, deleted.stderr);

    const deleteMarkerKey = `${effectiveMarkerPrefix}DeleteObject/${sourceBucket}/${objectKey}.json`;
    const deleteMarker = await waitForR2JsonObject(markerBucket, deleteMarkerKey, cloudflareEnv);
    assert.equal((deleteMarker as { event?: { action?: string } }).event?.action, "DeleteObject");
    assert.equal((deleteMarker as { event?: { object?: { key?: string } } }).event?.object?.key, objectKey);
  } finally {
    process.chdir(previousCwd);
    await cleanupNotification(sourceBucket, queue, cloudflareEnv).catch(() => undefined);
    await cleanupWorker(worker, cloudflareEnv).catch(() => undefined);
    await cleanupQueue(queue, cloudflareEnv).catch(() => undefined);
    await cleanupQueue(deadLetterQueue, cloudflareEnv).catch(() => undefined);
    await run("wrangler", ["r2", "object", "delete", `${sourceBucket}/${objectKey}`, "--remote"], { env: cloudflareEnv }).catch(() => undefined);
    await cleanupBucket(sourceBucket, cloudflareEnv).catch(() => undefined);
    await cleanupBucket(markerBucket, cloudflareEnv).catch(() => undefined);
    if (markerTokenId) {
      await deleteCloudflareApiToken({ tokenId: markerTokenId, execute: true }).catch(() => undefined);
    }
    if (deliveryTokenId) {
      await deleteCloudflareApiToken({ tokenId: deliveryTokenId, execute: true }).catch(() => undefined);
    }
    await cleanupVercelProject(name).catch(() => undefined);
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test("live Cloudflare R2 credentials flow creates env values and deletes the token", {
  skip: liveR2CredentialsEnabled ? false : liveR2CredentialsSkipReason,
  timeout: testTimeoutMs
}, async () => {
  const env = await requireCloudflareAuth();
  const name = `stacksmith-live-r2-creds-${projectSuffix()}`;
  const bucket = `${name}-dev`;
  const root = join(await mkdtemp(join(tmpdir(), "stacksmith-live-r2-creds-")), name);
  const envFile = join(root, ".env.local");
  const result = await createProject({ name, targetDir: root, force: true });
  const createBucket = providerCommandPlan("cloudflare", result.manifest)
    .find((command) => command.id === "cloudflare.r2.dev");
  let tokenId: string | undefined;

  try {
    assert.ok(createBucket);
    const commandResult = await runExternalCommand({ command: createBucket, execute: true, env });
    assert.equal(commandResult.status, "executed", commandResult.stderr ?? commandResult.message);

    const credentials = await createR2Credentials({
      manifest: result.manifest,
      environment: "development",
      envFile,
      execute: true
    });
    tokenId = credentials.tokenId;

    assert.equal(credentials.status, "configured");
    assert.ok(tokenId);

    const content = await readFile(envFile, "utf8");
    assert.match(content, new RegExp(`^R2_BUCKET_NAME=${bucket}$`, "m"));
    assert.match(content, /^R2_ACCESS_KEY_ID=/m);
    assert.match(content, /^R2_SECRET_ACCESS_KEY=/m);
    assert.doesNotMatch(content, /CLOUDFLARE_API_TOKEN/);

    const deleteToken = await deleteCloudflareApiToken({ tokenId, execute: true });
    assert.equal(deleteToken.status, "deleted");
    tokenId = undefined;

    const deleteBucket = await runExternalCommand({ command: createBucket, execute: true, mode: "undo", env });
    assert.equal(deleteBucket.status, "executed", deleteBucket.stderr ?? deleteBucket.message);
    await assertBucketDeleted(bucket, env);
  } finally {
    if (tokenId) {
      await deleteCloudflareApiToken({ tokenId, execute: true }).catch(() => undefined);
    }
    await cleanupBucket(bucket, env);
    await rm(dirname(root), { recursive: true, force: true });
  }
});
