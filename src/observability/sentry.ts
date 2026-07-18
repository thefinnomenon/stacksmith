import type { EnvironmentName } from "../core/types.js";

export interface SentryIssueQuery {
  organizationSlug: string;
  projectSlug?: string;
  environment?: EnvironmentName;
  previewId?: string;
  release?: string;
  query?: string;
  limit?: number;
}

export interface SentryIssueSummary {
  id: string;
  title: string;
  culprit?: string;
  permalink?: string;
  level?: string;
  status?: string;
  count?: number;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  tags: Record<string, string | undefined>;
}

export function buildSentrySearchQuery(input: SentryIssueQuery): string {
  const parts = ["is:unresolved"];

  if (input.environment) {
    parts.push(`environment:${input.environment}`);
  }

  if (input.previewId) {
    parts.push(`preview_id:${input.previewId}`);
  }

  if (input.release) {
    parts.push(`release:${input.release}`);
  }

  if (input.query) {
    parts.push(input.query);
  }

  return parts.join(" ");
}

export function sentryIssueEndpoint(input: SentryIssueQuery): string {
  const params = new URLSearchParams({
    query: buildSentrySearchQuery(input),
    limit: String(input.limit ?? 25)
  });

  return `/api/0/organizations/${input.organizationSlug}/issues/?${params.toString()}`;
}

export function normalizeSentryIssue(raw: Record<string, unknown>): SentryIssueSummary {
  const metadata = typeof raw.metadata === "object" && raw.metadata ? raw.metadata as Record<string, unknown> : {};
  const tags = typeof raw.tags === "object" && raw.tags ? raw.tags as Record<string, string | undefined> : {};

  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? metadata.title ?? "Untitled Sentry issue"),
    culprit: typeof raw.culprit === "string" ? raw.culprit : undefined,
    permalink: typeof raw.permalink === "string" ? raw.permalink : undefined,
    level: typeof raw.level === "string" ? raw.level : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    count: typeof raw.count === "number" ? raw.count : undefined,
    userCount: typeof raw.userCount === "number" ? raw.userCount : undefined,
    firstSeen: typeof raw.firstSeen === "string" ? raw.firstSeen : undefined,
    lastSeen: typeof raw.lastSeen === "string" ? raw.lastSeen : undefined,
    tags
  };
}
