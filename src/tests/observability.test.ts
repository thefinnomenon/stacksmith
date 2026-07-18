import assert from "node:assert/strict";
import test from "node:test";
import { mixpanelRetentionEndpoint, plannedMixpanelMetric } from "../observability/mixpanel.js";
import { buildSentrySearchQuery, normalizeSentryIssue, sentryIssueEndpoint } from "../observability/sentry.js";

test("Sentry facade builds preview-aware issue queries", () => {
  const query = buildSentrySearchQuery({
    organizationSlug: "acme",
    environment: "preview",
    previewId: "pr-184",
    release: "abc123"
  });

  assert.equal(query, "is:unresolved environment:preview preview_id:pr-184 release:abc123");
  assert.match(sentryIssueEndpoint({ organizationSlug: "acme", previewId: "pr-184" }), /preview_id%3Apr-184/);
});

test("Sentry facade normalizes raw issue payloads", () => {
  const issue = normalizeSentryIssue({
    id: 123,
    title: "Crash",
    status: "unresolved",
    tags: { preview_id: "pr-184" }
  });

  assert.equal(issue.id, "123");
  assert.equal(issue.tags.preview_id, "pr-184");
});

test("Mixpanel facade builds retention endpoints and planned metric shapes", () => {
  const endpoint = mixpanelRetentionEndpoint({
    projectId: "42",
    fromDate: "2026-07-01",
    toDate: "2026-07-16",
    bornEvent: "Signup",
    returningEvent: "Active",
    environment: "production"
  });

  assert.match(endpoint, /project_id=42/);
  assert.match(endpoint, /retention_type=birth/);
  assert.equal(plannedMixpanelMetric({
    projectId: "42",
    question: "retention",
    fromDate: "2026-07-01",
    toDate: "2026-07-16"
  }).unit, "percent");
});
