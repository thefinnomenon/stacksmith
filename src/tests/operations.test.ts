import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { actionRegistry, getAction } from "../operations/actions.js";
import { buildPreviewMetadata, incidentFingerprint, type Incident } from "../operations/incidents.js";
import { buildIncidentSlackMessage, verifySlackSignature } from "../operations/slack.js";
import { listMcpTools } from "../operations/mcp.js";

function sampleIncident(): Incident {
  return {
    id: "inc_123",
    projectId: "facereel",
    environment: "preview",
    previewId: "pr-184",
    pullRequestNumber: 184,
    source: "sentry",
    category: "runtime-error",
    severity: "error",
    status: "open",
    title: "Preview API crashed",
    summary: "Cloud Run preview failed its health check after a Prisma error.",
    git: {
      repository: "stacksmith/facereel",
      branch: "feat/billing",
      sha: "abc123",
      pullRequest: 184
    },
    deployment: {
      webUrl: "https://preview.example.com",
      apiUrl: "https://api-preview.example.com"
    },
    evidence: [{ type: "sentry-issue", issueId: "123", url: "https://sentry.example/issues/123" }],
    actions: [],
    attemptedFixes: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

test("incident fingerprint is stable for the same preview failure", () => {
  const incident = sampleIncident();
  assert.equal(incidentFingerprint(incident), incidentFingerprint(incident));
});

test("preview metadata includes AI-readable deployment fields", () => {
  const metadata = buildPreviewMetadata({
    projectId: "facereel",
    previewId: "pr-184",
    pullRequestNumber: 184,
    gitBranch: "feat/billing",
    gitSha: "abc123",
    webUrl: "https://preview.example.com"
  });

  assert.equal(metadata.environment, "preview");
  assert.equal(metadata.preview_id, "pr-184");
  assert.equal(metadata.github_pr, 184);
});

test("Slack incident message exposes registered actions", () => {
  const incident = sampleIncident();
  const message = buildIncidentSlackMessage({
    channel: "#facereel-alerts",
    incident,
    actions: actionRegistry
  });

  assert.equal(message.channel, "#facereel-alerts");
  assert.match(JSON.stringify(message.blocks), /incident.open_sentry/);
});

test("Slack signature verification accepts valid signatures", () => {
  const signingSecret = "secret";
  const timestamp = "1000";
  const rawBody = "payload={}";
  const signature = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;

  assert.equal(
    verifySlackSignature({
      signingSecret,
      timestamp,
      rawBody,
      signature,
      nowSeconds: 1000
    }),
    true
  );
});

test("MCP registry exposes incident and action tools", () => {
  assert.equal(listMcpTools().some((tool) => tool.name === "execute_action"), true);
  assert.equal(getAction("incident.open_sentry").label, "Open Sentry");
});
