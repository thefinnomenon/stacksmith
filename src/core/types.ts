export type EnvironmentName = "development" | "preview" | "staging" | "production";

export type ProviderId =
  | "github"
  | "vercel"
  | "cloud-run"
  | "prisma-postgres"
  | "cloudflare"
  | "resend"
  | "stripe"
  | "sentry"
  | "mixpanel"
  | "slack";

export type ChangeAction = "create" | "update" | "noop" | "delete";
export type ChangeRisk = "read-only" | "reversible" | "production-write" | "destructive";

export type HealthStatus = "healthy" | "degraded" | "missing" | "unknown";

export interface EnvironmentConfig {
  appUrl: string;
  apiUrl?: string;
  filesUrl?: string;
  authCallbackUrl?: string;
  stripeWebhookUrl?: string;
  emailLinkBaseUrl?: string;
}

export interface DomainConfig {
  mode: "free" | "subdomain" | "managed";
  baseDomain?: string;
  projectSubdomain?: string;
  apexDomain?: string;
  activeDomain?: string;
}

export interface PreviewConfig {
  enabled: boolean;
  expireAfterHours: number;
  database: "isolated" | "shared-staging";
  backend: "isolated" | "shared-staging" | "disabled";
  storage: "staging-prefix" | "disabled";
  stripe: "router" | "disabled";
  sentry: "tagged" | "disabled";
  mixpanel: "disabled" | "tagged";
}

export interface ProviderConfig {
  enabled: boolean;
  mode?: string;
  notes?: string;
  requiredEnv?: string[];
}

export interface ProvidersConfig {
  github: ProviderConfig & { owner?: string; private?: boolean };
  vercel: ProviderConfig & { team?: string };
  "cloud-run": ProviderConfig & {
    projectId?: string;
    region?: string;
    apiService?: boolean;
    jobs?: boolean;
    scheduler?: boolean;
  };
  "prisma-postgres": ProviderConfig & { previewStrategy?: PreviewConfig["database"] };
  cloudflare: ProviderConfig & {
    registrar?: boolean;
    dns?: boolean;
    r2?: boolean;
    tunnel?: boolean;
  };
  resend: ProviderConfig & { inboundForwarding?: boolean };
  stripe: ProviderConfig & { previewRouter?: boolean };
  sentry: ProviderConfig & { previewTagging?: boolean };
  mixpanel: ProviderConfig & { enabledInPreview?: boolean };
  slack: ProviderConfig & { workspace?: string; activityChannel?: string; alertsChannel?: string };
}

export interface OperationsConfig {
  incidents: {
    enabled: boolean;
    deduplicate: boolean;
    retainDays: number;
  };
  ai: {
    previewAutoDiagnose: boolean;
    previewAutoFix: boolean;
    maximumFixAttempts: number;
    productionCreatesFixPr: boolean;
  };
  slackActions: {
    openSentry: boolean;
    viewLogs: boolean;
    retryJob: boolean;
    retryDeployment: boolean;
    askAiToDiagnose: boolean;
    askAiToFix: boolean;
  };
}

export interface ProjectManifest {
  schemaVersion: 1;
  name: string;
  slug: string;
  domainMode: "free" | "subdomain" | "managed";
  domainConfig: DomainConfig;
  domain?: string;
  backendMode: "next-only" | "worker" | "hybrid";
  environments: Record<EnvironmentName, EnvironmentConfig>;
  previews: PreviewConfig;
  providers: ProvidersConfig;
  operations: OperationsConfig;
}

export interface ProviderResourceState {
  externalId?: string;
  name: string;
  kind: string;
  status: "planned" | "created" | "configured" | "missing" | "stubbed";
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderState {
  provider: ProviderId;
  status: "unconfigured" | "planned" | "applied" | "disabled";
  appliedConfigHash?: string;
  resources: ProviderResourceState[];
  lastInspectedAt?: string;
  lastAppliedAt?: string;
}

export interface ProjectState {
  schemaVersion: 1;
  projectSlug: string;
  createdAt: string;
  updatedAt: string;
  providers: Partial<Record<ProviderId, ProviderState>>;
}

export interface InspectResult {
  provider: ProviderId;
  enabled: boolean;
  resources: ProviderResourceState[];
  messages: string[];
}

export interface PlannedChange {
  id: string;
  provider: ProviderId;
  action: ChangeAction;
  risk: ChangeRisk;
  summary: string;
  details?: Record<string, unknown>;
}

export interface PlanResult {
  project: string;
  changes: PlannedChange[];
  messages: string[];
}

export interface HealthCheckResult {
  provider: ProviderId;
  status: HealthStatus;
  checks: Array<{
    name: string;
    status: HealthStatus;
    message: string;
  }>;
}

export interface ApplyResult {
  provider: ProviderId;
  applied: PlannedChange[];
  skipped: PlannedChange[];
  messages: string[];
  state: ProviderState;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  inspect(manifest: ProjectManifest, state: ProjectState): Promise<InspectResult>;
  plan(manifest: ProjectManifest, state: ProjectState): Promise<PlannedChange[]>;
  apply(manifest: ProjectManifest, state: ProjectState, changes: PlannedChange[]): Promise<ApplyResult>;
  health(manifest: ProjectManifest, state: ProjectState): Promise<HealthCheckResult>;
}
