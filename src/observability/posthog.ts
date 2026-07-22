import type { EnvironmentName } from "../core/types.js";

export interface PostHogBaseQuery {
  projectId: string;
  projectSlug: string;
  environment?: EnvironmentName;
  previewId?: string;
  release?: string;
}

export interface PostHogIssueQuery extends PostHogBaseQuery {
  query?: string;
  limit?: number;
}

export interface PostHogIssueSummary {
  id: string;
  title: string;
  status?: string;
  level?: string;
  count?: number;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  url?: string;
  properties: Record<string, string | undefined>;
}

export interface PostHogMetricQuestion extends PostHogBaseQuery {
  question:
    | "retention"
    | "activation"
    | "conversion"
    | "active-users"
    | "event-count";
  fromDate: string;
  toDate: string;
  event?: string;
}

export interface ProductHealthMetric {
  label: string;
  value: number;
  unit: "count" | "percent" | "ratio";
  period: {
    fromDate: string;
    toDate: string;
  };
  source: "posthog";
  query: Record<string, unknown>;
}

export interface PostHogLogQuery extends PostHogBaseQuery {
  query: string;
  timeRange?: string;
}

export function posthogGlobalProperties(input: PostHogBaseQuery) {
  return {
    project_slug: input.projectSlug,
    app_environment: input.environment,
    preview_id: input.previewId,
    git_sha: input.release
  };
}

export function buildPostHogFilterQuery(input: PostHogBaseQuery): string {
  const parts = [`project_slug:${input.projectSlug}`];

  if (input.environment) {
    parts.push(`app_environment:${input.environment}`);
  }

  if (input.previewId) {
    parts.push(`preview_id:${input.previewId}`);
  }

  if (input.release) {
    parts.push(`git_sha:${input.release}`);
  }

  return parts.join(" ");
}

export function posthogIssueEndpoint(input: PostHogIssueQuery): string {
  const params = new URLSearchParams({
    q: [buildPostHogFilterQuery(input), input.query].filter(Boolean).join(" "),
    limit: String(input.limit ?? 25)
  });

  return `/api/projects/${input.projectId}/error_tracking/query/issues/?${params.toString()}`;
}

export function normalizePostHogIssue(raw: Record<string, unknown>): PostHogIssueSummary {
  const properties = typeof raw.properties === "object" && raw.properties
    ? raw.properties as Record<string, string | undefined>
    : {};

  return {
    id: String(raw.id ?? ""),
    title: String(raw.name ?? raw.title ?? "Untitled PostHog issue"),
    status: typeof raw.status === "string" ? raw.status : undefined,
    level: typeof raw.level === "string" ? raw.level : undefined,
    count: typeof raw.count === "number" ? raw.count : undefined,
    userCount: typeof raw.users === "number" ? raw.users : undefined,
    firstSeen: typeof raw.first_seen === "string" ? raw.first_seen : undefined,
    lastSeen: typeof raw.last_seen === "string" ? raw.last_seen : undefined,
    url: typeof raw.url === "string" ? raw.url : undefined,
    properties
  };
}

export function plannedPostHogMetric(input: PostHogMetricQuestion): ProductHealthMetric {
  return {
    label: input.question,
    value: 0,
    unit: input.question === "retention" || input.question === "conversion" || input.question === "activation" ? "percent" : "count",
    period: {
      fromDate: input.fromDate,
      toDate: input.toDate
    },
    source: "posthog",
    query: {
      ...input,
      filters: posthogGlobalProperties(input)
    }
  };
}

export function posthogLogsEndpoint(input: PostHogLogQuery): string {
  const params = new URLSearchParams({
    q: [buildPostHogFilterQuery(input), input.query].filter(Boolean).join(" ")
  });

  if (input.timeRange) {
    params.set("time_range", input.timeRange);
  }

  return `/api/projects/${input.projectId}/logs/?${params.toString()}`;
}

export function posthogReplayUrl(input: PostHogBaseQuery & { replayId: string }): string {
  return `/project/${input.projectId}/replay/${input.replayId}`;
}
