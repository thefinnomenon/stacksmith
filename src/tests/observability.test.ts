import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPostHogFilterQuery,
  normalizePostHogIssue,
  plannedPostHogMetric,
  posthogIssueEndpoint,
  posthogLogsEndpoint,
  posthogReplayUrl
} from "../observability/posthog.js";

test("PostHog facade builds project and preview aware issue queries", () => {
  const query = buildPostHogFilterQuery({
    projectId: "123",
    projectSlug: "facereel",
    environment: "preview",
    previewId: "pr-184",
    release: "abc123"
  });

  assert.equal(query, "project_slug:facereel app_environment:preview preview_id:pr-184 git_sha:abc123");
  assert.match(
    posthogIssueEndpoint({ projectId: "123", projectSlug: "facereel", previewId: "pr-184" }),
    /preview_id%3Apr-184/
  );
});

test("PostHog facade normalizes raw issue payloads", () => {
  const issue = normalizePostHogIssue({
    id: 123,
    name: "Crash",
    status: "active",
    properties: { preview_id: "pr-184", project_slug: "facereel" }
  });

  assert.equal(issue.id, "123");
  assert.equal(issue.title, "Crash");
  assert.equal(issue.properties.preview_id, "pr-184");
});

test("PostHog facade plans product metrics and log/replay references", () => {
  const metric = plannedPostHogMetric({
    projectId: "123",
    projectSlug: "facereel",
    question: "retention",
    fromDate: "2026-07-01",
    toDate: "2026-07-22",
    environment: "production"
  });

  assert.equal(metric.source, "posthog");
  assert.equal(metric.unit, "percent");
  assert.equal((metric.query.filters as Record<string, unknown>).project_slug, "facereel");
  assert.match(
    posthogLogsEndpoint({ projectId: "123", projectSlug: "facereel", environment: "preview", previewId: "pr-184", query: "error" }),
    /project_slug%3Afacereel/
  );
  assert.equal(posthogReplayUrl({ projectId: "123", projectSlug: "facereel", replayId: "0184" }), "/project/123/replay/0184");
});
