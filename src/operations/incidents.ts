import type { EnvironmentName, ProviderId } from "../core/types.js";

export type IncidentSource =
  | ProviderId
  | "database"
  | "worker"
  | "health-check"
  | "mcp"
  | "unknown";

export type IncidentCategory =
  | "build-failure"
  | "runtime-error"
  | "migration-failure"
  | "job-failure"
  | "webhook-failure"
  | "health-check-failure"
  | "configuration-error";

export type IncidentSeverity = "warning" | "error" | "critical";
export type IncidentStatus = "open" | "investigating" | "fixing" | "verifying" | "resolved";

export interface GitReference {
  repository: string;
  branch: string;
  sha: string;
  pullRequest?: number;
}

export interface DeploymentReference {
  webUrl?: string;
  apiUrl?: string;
  deploymentId?: string;
  cloudRunServiceId?: string;
  vercelDeploymentId?: string;
}

export type EvidenceReference =
  | { type: "posthog-issue"; issueId: string; url: string; fingerprint?: string }
  | { type: "posthog-insight"; insightId: string; url: string }
  | { type: "posthog-log-query"; query: string; url: string }
  | { type: "posthog-replay"; replayId: string; url: string }
  | { type: "cloud-run-logs"; serviceId: string; timeRange: string; url?: string }
  | { type: "vercel-build"; deploymentId: string; url?: string }
  | { type: "job-run"; jobId: string; url?: string }
  | { type: "github-check"; checkRunId: string; url?: string }
  | { type: "health-check"; checkId: string; url?: string }
  | { type: "database-migration"; migrationId: string; url?: string }
  | { type: "stripe-event"; eventId: string; url?: string };

export interface IncidentAction {
  id: string;
  label: string;
  risk: "read-only" | "reversible" | "production-write" | "destructive";
}

export interface Incident {
  id: string;
  projectId: string;
  environment: EnvironmentName;
  previewId?: string;
  pullRequestNumber?: number;
  source: IncidentSource;
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  summary: string;
  git: GitReference;
  deployment: DeploymentReference;
  evidence: EvidenceReference[];
  actions: IncidentAction[];
  assignedAgent?: string;
  attemptedFixes: number;
  createdAt: string;
  updatedAt: string;
}

export function incidentFingerprint(incident: Pick<Incident, "projectId" | "environment" | "previewId" | "category" | "title" | "git">): string {
  return [
    incident.projectId,
    incident.environment,
    incident.previewId ?? "none",
    incident.git.sha,
    incident.category,
    incident.title.toLowerCase().replace(/\s+/g, " ").slice(0, 120)
  ].join(":");
}

export function buildPreviewMetadata(input: {
  projectId: string;
  previewId: string;
  pullRequestNumber: number;
  gitBranch: string;
  gitSha: string;
  webUrl?: string;
  apiUrl?: string;
}) {
  return {
    environment: "preview" as const,
    app_environment: "preview" as const,
    project_id: input.projectId,
    project_slug: input.projectId,
    preview_id: input.previewId,
    github_pr: input.pullRequestNumber,
    git_branch: input.gitBranch,
    git_sha: input.gitSha,
    web_url: input.webUrl,
    api_url: input.apiUrl
  };
}

export function buildObservabilityTags(input: {
  environment: EnvironmentName;
  previewId?: string;
  pullRequestNumber?: number;
  gitBranch?: string;
  gitSha?: string;
  deploymentProvider?: string;
  projectSlug?: string;
}) {
  return {
    app_environment: input.environment,
    project_slug: input.projectSlug,
    preview_id: input.previewId,
    github_pr: input.pullRequestNumber?.toString(),
    git_branch: input.gitBranch,
    git_sha: input.gitSha,
    deployment_provider: input.deploymentProvider
  };
}
