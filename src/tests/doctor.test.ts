import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultManifest } from "../core/defaults.js";
import { runDoctor } from "../core/doctor.js";
import { createInitialState } from "../core/state.js";
import type { CommandRunner } from "../core/process.js";

test("doctor reports credentials without printing secret values", async () => {
  const manifest = createDefaultManifest({ name: "FaceReel", domain: "facereel.com" });
  const state = createInitialState(manifest);
  const report = await runDoctor({
    manifest,
    state,
    env: {
      PATH: process.env.PATH,
      GITHUB_TOKEN: "secret-value"
    },
    runCommand: async (command, args) => {
      if (command === "gh" && args.join(" ") === "auth status") {
        return { exitCode: 0, stdout: "Logged in\n", stderr: "" };
      }

      return { exitCode: 0, stdout: "", stderr: "" };
    },
    executableExists: async (command) => command === "git" || command === "gh"
  });

  assert.equal(report.project, "facereel");
  assert.equal(report.checks.some((check) => check.id === "github.auth" && check.message === "GitHub CLI is authenticated."), true);
  assert.equal(JSON.stringify(report).includes("secret-value"), false);
});

test("doctor includes Cloud Run readiness when gcloud is available", async () => {
  const manifest = createDefaultManifest({ name: "FaceReel" });
  const state = createInitialState(manifest);
  const runCommand: CommandRunner = async (_command, args) => {
    const joined = args.join(" ");
    if (joined.includes("config get-value project")) {
      return { exitCode: 0, stdout: "demo-project\n", stderr: "" };
    }
    if (joined.includes("auth list")) {
      return { exitCode: 0, stdout: "me@example.com\n", stderr: "" };
    }
    if (joined.includes("billing projects describe")) {
      return { exitCode: 0, stdout: "true\n", stderr: "" };
    }
    if (joined.includes("services list")) {
      return {
        exitCode: 0,
        stdout: "run.googleapis.com\ncloudbuild.googleapis.com\nartifactregistry.googleapis.com\ncloudscheduler.googleapis.com\n",
        stderr: ""
      };
    }
    if (joined.includes("artifacts repositories list")) {
      return { exitCode: 0, stdout: "repo\n", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const report = await runDoctor({
    manifest,
    state,
    env: {
      PATH: "/usr/bin",
      GOOGLE_CLOUD_BILLING_ACCOUNT_ID: "AAAAAA-BBBBBB-CCCCCC"
    },
    runCommand,
    executableExists: async (command) => command === "gcloud"
  });

  assert.equal(report.checks.some((check) => check.id === "cloud-run.billing" && check.status === "pass"), true);
});
