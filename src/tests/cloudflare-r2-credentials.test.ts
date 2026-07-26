import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDefaultManifest } from "../core/defaults.js";
import {
  buildR2BucketResource,
  buildR2TokenCreateBody,
  cloudflareTokenSetupUrl,
  createR2Credentials,
  deleteCloudflareApiToken,
  deriveR2SecretAccessKey,
  parseWranglerAccountId,
  r2BucketNameForEnvironment,
  r2EnvValues,
  r2PrefixForEnvironment,
  setupCloudflareApiToken,
  updateEnvContent
} from "../providers/cloudflare-r2-credentials.js";

test("parseWranglerAccountId extracts account id from Wrangler table output", () => {
  const output = `
┌────────────────────────────────┬──────────────────────────────────┐
│ Account Name                   │ Account ID                       │
├────────────────────────────────┼──────────────────────────────────┤
│ Example Account                │ b928c988ffda26bd62bc406b7971d53c │
└────────────────────────────────┴──────────────────────────────────┘
`;

  assert.equal(parseWranglerAccountId(output), "b928c988ffda26bd62bc406b7971d53c");
});

test("deriveR2SecretAccessKey hashes the one-time Cloudflare token value", () => {
  assert.equal(
    deriveR2SecretAccessKey("token-value"),
    "e6c02a5742ea9d4de588eb9b9de7bed43dc17011552186bed3e98b2c5958ff4a"
  );
});

test("r2 environment defaults use staging bucket with preview prefix", () => {
  const manifest = createDefaultManifest({ name: "Face Reel", domain: "facereel.com" });

  assert.equal(r2BucketNameForEnvironment(manifest, "development"), "face-reel-dev");
  assert.equal(r2BucketNameForEnvironment(manifest, "preview"), "face-reel-staging");
  assert.equal(r2BucketNameForEnvironment(manifest, "staging"), "face-reel-staging");
  assert.equal(r2BucketNameForEnvironment(manifest, "production"), "face-reel-production");
  assert.equal(r2PrefixForEnvironment("preview", "pr-184"), "previews/pr-184/");
  assert.equal(r2PrefixForEnvironment("production"), "");
});

test("buildR2TokenCreateBody scopes token to one bucket", () => {
  const body = buildR2TokenCreateBody({
    tokenName: "stacksmith-facereel-development-r2",
    accountId: "b928c988ffda26bd62bc406b7971d53c",
    bucketName: "facereel-dev",
    permissionGroupId: "permission-group-id"
  });

  assert.equal(body.name, "stacksmith-facereel-development-r2");
  assert.deepEqual(body.policies[0]?.resources, {
    [buildR2BucketResource("b928c988ffda26bd62bc406b7971d53c", "facereel-dev")]: "*"
  });
  assert.equal(body.policies[0]?.permission_groups[0]?.id, "permission-group-id");
});

test("updateEnvContent replaces existing keys and appends missing R2 keys", () => {
  const next = updateEnvContent("APP_URL=http://localhost:3000\nR2_BUCKET_NAME=old\n", {
    ...r2EnvValues({
      accountId: "account-id",
      accessKeyId: "access-key-id",
      secretAccessKey: "secret value",
      bucketName: "facereel-dev",
      filesUrl: "https://files.dev.facereel.com"
    })
  });

  assert.match(next, /^APP_URL=http:\/\/localhost:3000$/m);
  assert.match(next, /^R2_BUCKET_NAME=facereel-dev$/m);
  assert.match(next, /^R2_SECRET_ACCESS_KEY="secret value"$/m);
  assert.match(next, /^R2_ENDPOINT=https:\/\/account-id\.r2\.cloudflarestorage\.com$/m);
  assert.match(next, /^FILES_URL=https:\/\/files\.dev\.facereel\.com$/m);
});

test("createR2Credentials dry run does not require API token or write env file", async () => {
  const manifest = createDefaultManifest({ name: "Face Reel", domain: "facereel.com" });
  const result = await createR2Credentials({
    manifest,
    environment: "development",
    accountId: "b928c988ffda26bd62bc406b7971d53c",
    execute: false
  });

  assert.equal(result.status, "planned");
  assert.equal(result.bucketName, "face-reel-dev");
  assert.equal(result.endpoint, "https://b928c988ffda26bd62bc406b7971d53c.r2.cloudflarestorage.com");
  assert.ok(result.envKeys.includes("R2_SECRET_ACCESS_KEY"));
});

test("createR2Credentials creates token and writes derived env values without storing raw token", async () => {
  const root = await mkdtemp(join(tmpdir(), "stacksmith-r2-credentials-"));
  const envFile = join(root, ".env.local");
  const manifest = createDefaultManifest({ name: "Face Reel", domain: "facereel.com" });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });

    if (String(url).endsWith("/accounts/b928c988ffda26bd62bc406b7971d53c/tokens/permission_groups")) {
      return Response.json({
        success: true,
        result: [
          {
            id: "r2-write-permission-group",
            name: "Workers R2 Storage Bucket Item Write"
          }
        ]
      });
    }

    return Response.json({
      success: true,
      result: {
        id: "created-token-id",
        value: "one-time-token-value",
        name: "created-token-name"
      }
    });
  };

  try {
    const result = await createR2Credentials({
      manifest,
      environment: "development",
      accountId: "b928c988ffda26bd62bc406b7971d53c",
      tokenName: "stacksmith-facereel-development-r2",
      envFile,
      execute: true,
      apiToken: "parent-token",
      fetchImpl
    });
    const env = await readFile(envFile, "utf8");

    assert.equal(result.status, "configured");
    assert.equal(result.tokenId, "created-token-id");
    assert.equal(calls.length, 2);
    assert.match(env, /^R2_ACCESS_KEY_ID=created-token-id$/m);
    assert.match(env, new RegExp(`^R2_SECRET_ACCESS_KEY=${deriveR2SecretAccessKey("one-time-token-value")}$`, "m"));
    assert.doesNotMatch(env, /one-time-token-value/);
    assert.match(env, /^R2_BUCKET_NAME=face-reel-dev$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deleteCloudflareApiToken is dry-run by default and calls delete when executed", async () => {
  const calls: string[] = [];
  const dryRun = await deleteCloudflareApiToken({ tokenId: "token-id" });

  assert.equal(dryRun.status, "planned");

  const deleted = await deleteCloudflareApiToken({
    tokenId: "token-id",
    accountId: "b928c988ffda26bd62bc406b7971d53c",
    apiToken: "parent-token",
    execute: true,
    fetchImpl: async (url: string | URL | Request) => {
      calls.push(String(url));
      return Response.json({ success: true, result: { id: "token-id" } });
    }
  });

  assert.equal(deleted.status, "deleted");
  assert.deepEqual(calls, ["https://api.cloudflare.com/client/v4/accounts/b928c988ffda26bd62bc406b7971d53c/tokens/token-id"]);
});

test("setupCloudflareApiToken prints instructions and can open the token page", async () => {
  const opened: string[] = [];
  const result = await setupCloudflareApiToken({
    open: true,
    opener: async (url) => {
      opened.push(url);
    }
  });

  assert.equal(result.status, "instructions");
  assert.equal(result.tokenPageUrl, cloudflareTokenSetupUrl());
  assert.equal(result.opened, true);
  assert.deepEqual(opened, [cloudflareTokenSetupUrl()]);
  assert.ok(result.requiredPermissions.some((line) => line.includes("Account API Tokens")));
});

test("setupCloudflareApiToken validates and saves a parent token when executed", async () => {
  const root = await mkdtemp(join(tmpdir(), "stacksmith-cloudflare-token-"));
  const envFile = join(root, ".env.stacksmith.local");
  const calls: string[] = [];
  const fetchImpl = async (url: string | URL | Request) => {
    calls.push(String(url));

    if (String(url).endsWith("/user/tokens/verify")) {
      return Response.json({ success: true, result: { id: "parent-token-id", status: "active" } });
    }

    return Response.json({
      success: true,
      result: [
        {
          id: "r2-write-permission-group",
          name: "Workers R2 Storage Bucket Item Write"
        }
      ]
    });
  };

  try {
    const result = await setupCloudflareApiToken({
      apiToken: "parent-token-value",
      accountId: "b928c988ffda26bd62bc406b7971d53c",
      envFile,
      save: true,
      execute: true,
      fetchImpl
    });
    const env = await readFile(envFile, "utf8");

    assert.equal(result.status, "saved");
    assert.equal(result.validated, true);
    assert.equal(result.saved, true);
    assert.match(env, /^CLOUDFLARE_API_TOKEN=parent-token-value$/m);
    assert.match(env, /^CLOUDFLARE_ACCOUNT_ID=b928c988ffda26bd62bc406b7971d53c$/m);
    assert.deepEqual(calls, [
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      "https://api.cloudflare.com/client/v4/accounts/b928c988ffda26bd62bc406b7971d53c/tokens/permission_groups"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
