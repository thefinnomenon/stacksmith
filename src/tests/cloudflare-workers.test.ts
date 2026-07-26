import assert from "node:assert/strict";
import test from "node:test";
import {
  checkCloudflareWorkersSubdomain,
  cloudflareWorkersSetupUrl,
  setupCloudflareWorkers
} from "../providers/cloudflare-workers.js";

test("checkCloudflareWorkersSubdomain reports ready subdomain", async () => {
  const result = await checkCloudflareWorkersSubdomain({
    accountId: "account-id",
    apiToken: "token",
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://api.cloudflare.com/client/v4/accounts/account-id/workers/subdomain");
      return Response.json({
        success: true,
        result: { subdomain: "stacksmith-dev" }
      });
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.subdomain, "stacksmith-dev");
});

test("checkCloudflareWorkersSubdomain reports missing workers.dev prerequisite", async () => {
  const result = await checkCloudflareWorkersSubdomain({
    accountId: "account-id",
    apiToken: "token",
    fetchImpl: async () => Response.json({
      success: false,
      errors: [{ code: 10007, message: "You do not have a workers.dev subdomain." }]
    }, { status: 400 })
  });

  assert.equal(result.status, "missing");
  assert.match(result.message, /workers\.dev/);
  assert.equal(result.setupUrl, cloudflareWorkersSetupUrl());
});

test("setupCloudflareWorkers can open the setup page without executing verification", async () => {
  const opened: string[] = [];
  const result = await setupCloudflareWorkers({
    open: true,
    opener: async (url) => {
      opened.push(url);
    }
  });

  assert.deepEqual(opened, [cloudflareWorkersSetupUrl()]);
  assert.equal(result.opened, true);
  assert.equal(result.status, "unknown");
});
