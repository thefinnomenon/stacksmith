import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultManifest } from "../core/defaults.js";
import type { CommandRunner } from "../core/process.js";
import { cloudRunReadinessChecks, cloudRunRequiredApis } from "../providers/cloud-run-readiness.js";

test("cloudRunReadinessChecks reports project auth billing APIs and region", async () => {
  const manifest = createDefaultManifest({ name: "FaceReel" });
  const run: CommandRunner = async (_command, args) => {
    const joined = args.join(" ");

    if (joined.includes("config get-value project")) {
      return { exitCode: 0, stdout: "demo-project\n", stderr: "" };
    }

    if (joined.includes("auth list")) {
      return { exitCode: 0, stdout: "me@example.com\n", stderr: "" };
    }

    if (joined.includes("billing projects describe")) {
      assert.equal(args.includes("ss-facereel"), true);
      return { exitCode: 0, stdout: "true\n", stderr: "" };
    }

    if (joined.includes("services list")) {
      return { exitCode: 0, stdout: `${cloudRunRequiredApis.join("\n")}\n`, stderr: "" };
    }

    if (joined.includes("artifacts repositories list")) {
      return { exitCode: 0, stdout: "projects/demo/locations/us-central1/repositories/app\n", stderr: "" };
    }

    return { exitCode: 1, stdout: "", stderr: "unexpected" };
  };

  const checks = await cloudRunReadinessChecks({
    manifest,
    run,
    env: { GOOGLE_CLOUD_BILLING_ACCOUNT_ID: "AAAAAA-BBBBBB-CCCCCC" }
  });

  assert.equal(checks.find((check) => check.id === "cloud-run.project")?.status, "pass");
  assert.equal(checks.find((check) => check.id === "cloud-run.project")?.message, "Project is ss-facereel.");
  assert.equal(checks.find((check) => check.id === "cloud-run.auth")?.status, "pass");
  assert.equal(checks.find((check) => check.id === "cloud-run.billing-account")?.status, "pass");
  assert.equal(checks.find((check) => check.id === "cloud-run.billing")?.status, "pass");
  assert.equal(checks.find((check) => check.id === "cloud-run.region")?.message, "Region is us-central1.");
  assert.equal(checks.filter((check) => check.id.startsWith("cloud-run.api.") && check.status === "pass").length, cloudRunRequiredApis.length);
});

test("cloudRunReadinessChecks warns when billing account env is missing", async () => {
  const manifest = createDefaultManifest({ name: "FaceReel" });
  const run: CommandRunner = async () => ({ exitCode: 0, stdout: "", stderr: "" });
  const checks = await cloudRunReadinessChecks({ manifest, run, env: {} });

  assert.equal(checks.find((check) => check.id === "cloud-run.project")?.status, "pass");
  assert.equal(checks.find((check) => check.id === "cloud-run.billing-account")?.status, "warn");
  assert.equal(checks.find((check) => check.id === "cloud-run.billing")?.status, "warn");
});
