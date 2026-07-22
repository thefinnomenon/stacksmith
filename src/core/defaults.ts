import type { DomainConfig, EnvironmentName, OperationsConfig, PreviewConfig, ProjectManifest, ProvidersConfig } from "./types.js";
import { cloudRunDefaultRegion, defaultGoogleCloudProjectId } from "../providers/cloud-run-project.js";

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function defaultEnvironments(slug: string, domain?: string): ProjectManifest["environments"] {
  if (!domain) {
    return {
      development: {
        appUrl: "http://localhost:3000",
        apiUrl: "http://localhost:4000",
        filesUrl: `https://${slug}-dev.r2.dev`,
        authCallbackUrl: "http://localhost:3000/api/auth/callback",
        stripeWebhookUrl: "http://localhost:4000/webhooks/stripe",
        emailLinkBaseUrl: "http://localhost:3000"
      },
      preview: {
        appUrl: `https://${slug}-git-{branch}.vercel.app`,
        apiUrl: `https://${slug}-api-pr-{previewId}-{region}.a.run.app`,
        filesUrl: `https://${slug}-staging.r2.dev/previews/{previewId}`,
        authCallbackUrl: `https://${slug}-git-{branch}.vercel.app/api/auth/callback`,
        stripeWebhookUrl: `https://${slug}-stripe-preview.vercel.app/webhooks`,
        emailLinkBaseUrl: `https://${slug}-git-{branch}.vercel.app`
      },
      staging: {
        appUrl: `https://${slug}-staging.vercel.app`,
        apiUrl: `https://${slug}-api-staging-{region}.a.run.app`,
        filesUrl: `https://${slug}-staging.r2.dev`,
        authCallbackUrl: `https://${slug}-staging.vercel.app/api/auth/callback`,
        stripeWebhookUrl: `https://${slug}-api-staging-{region}.a.run.app/webhooks/stripe`,
        emailLinkBaseUrl: `https://${slug}-staging.vercel.app`
      },
      production: {
        appUrl: `https://${slug}.vercel.app`,
        apiUrl: `https://${slug}-api-{region}.a.run.app`,
        filesUrl: `https://${slug}-production.r2.dev`,
        authCallbackUrl: `https://${slug}.vercel.app/api/auth/callback`,
        stripeWebhookUrl: `https://${slug}-api-{region}.a.run.app/webhooks/stripe`,
        emailLinkBaseUrl: `https://${slug}.vercel.app`
      }
    };
  }

  const host = domain;
  const environments: Record<EnvironmentName, ProjectManifest["environments"][EnvironmentName]> = {
    development: {
      appUrl: `https://dev.${host}`,
      apiUrl: `https://api.dev.${host}`,
      filesUrl: `https://files.dev.${host}`,
      authCallbackUrl: `https://dev.${host}/api/auth/callback`,
      stripeWebhookUrl: `https://api.dev.${host}/webhooks/stripe`,
      emailLinkBaseUrl: `https://dev.${host}`
    },
    preview: {
      appUrl: `https://{previewHost}`,
      apiUrl: `https://api-{previewId}.${slug}.preview.internal`,
      filesUrl: `https://files.staging.${host}/previews/{previewId}`,
      authCallbackUrl: `https://auth-preview.${host}/callback`,
      stripeWebhookUrl: `https://stripe-preview.${host}/webhooks`,
      emailLinkBaseUrl: `https://{previewHost}`
    },
    staging: {
      appUrl: `https://staging.${host}`,
      apiUrl: `https://api.staging.${host}`,
      filesUrl: `https://files.staging.${host}`,
      authCallbackUrl: `https://staging.${host}/api/auth/callback`,
      stripeWebhookUrl: `https://api.staging.${host}/webhooks/stripe`,
      emailLinkBaseUrl: `https://staging.${host}`
    },
    production: {
      appUrl: `https://${host}`,
      apiUrl: `https://api.${host}`,
      filesUrl: `https://files.${host}`,
      authCallbackUrl: `https://${host}/api/auth/callback`,
      stripeWebhookUrl: `https://api.${host}/webhooks/stripe`,
      emailLinkBaseUrl: `https://${host}`
    }
  };

  return environments;
}

export function createDomainConfig(input: {
  domain?: string;
  baseDomain?: string;
  projectSubdomain?: string;
}): DomainConfig {
  if (input.domain) {
    return {
      mode: "managed",
      apexDomain: input.domain,
      activeDomain: input.domain
    };
  }

  if (input.baseDomain) {
    const projectSubdomain = slugify(input.projectSubdomain ?? "");
    if (!projectSubdomain) {
      throw new Error("projectSubdomain is required when baseDomain is provided.");
    }

    return {
      mode: "subdomain",
      baseDomain: input.baseDomain,
      projectSubdomain,
      activeDomain: `${projectSubdomain}.${input.baseDomain}`
    };
  }

  return {
    mode: "free"
  };
}

export const defaultPreviewConfig: PreviewConfig = {
  enabled: true,
  expireAfterHours: 96,
  database: "isolated",
  backend: "isolated",
  storage: "staging-prefix",
  stripe: "router",
  observability: "posthog-tagged"
};

export function defaultProviders(slug: string): ProvidersConfig {
  return {
    github: { enabled: true, private: true },
    vercel: { enabled: true },
    "cloud-run": {
      enabled: true,
      projectId: defaultGoogleCloudProjectId(slug),
      region: cloudRunDefaultRegion,
      apiService: true,
      jobs: true,
      scheduler: true
    },
    "prisma-postgres": {
      enabled: true,
      via: "vercel-marketplace",
      region: "iad1",
      billingPlan: "free",
      previewStrategy: "isolated",
      previewProvisioning: "github-actions-management-api",
      acceleration: {
        connectionPooling: true,
        queryCache: "optional-per-query"
      }
    },
    cloudflare: {
      enabled: true,
      registrar: true,
      dns: true,
      r2: true,
      tunnel: true,
      r2Events: true,
      r2EventTypes: ["object-create", "object-delete"],
      r2EventForwarder: {
        queueName: `${slug}-r2-events`,
        workerName: `${slug}-r2-event-forwarder`,
        endpointPath: "/api/webhook/cloudflare/r2"
      }
    },
    resend: { enabled: true, inboundForwarding: true },
    stripe: { enabled: true, previewRouter: true },
    posthog: {
      enabled: true,
      allocation: "shared-incubator",
      sharedProjectName: "stacksmith-incubator",
      projectName: `${slug}-posthog`,
      analytics: true,
      errorTracking: true,
      logs: true,
      sessionReplay: "production-sampled",
      flags: true,
      previewTagging: true,
      slackRoutingTags: true
    },
    slack: { enabled: true, activityChannel: slug, alertsChannel: `${slug}-alerts` }
  };
}

export const defaultOperations: OperationsConfig = {
  incidents: {
    enabled: true,
    deduplicate: true,
    retainDays: 90
  },
  ai: {
    previewAutoDiagnose: true,
    previewAutoFix: true,
    maximumFixAttempts: 2,
    productionCreatesFixPr: true
  },
  slackActions: {
    openPostHog: true,
    viewLogs: true,
    retryJob: true,
    retryDeployment: true,
    askAiToDiagnose: true,
    askAiToFix: true
  }
};

export function createDefaultManifest(input: {
  name: string;
  domain?: string;
  baseDomain?: string;
  projectSubdomain?: string;
  backendMode?: ProjectManifest["backendMode"];
}): ProjectManifest {
  const slug = slugify(input.name);

  if (!slug) {
    throw new Error("Project name must contain at least one letter or number.");
  }

  const domainConfig = createDomainConfig({
    domain: input.domain,
    baseDomain: input.baseDomain,
    projectSubdomain: input.projectSubdomain ?? slug
  });
  const activeDomain = domainConfig.activeDomain;

  return {
    schemaVersion: 1,
    name: input.name.trim(),
    slug,
    domainMode: domainConfig.mode,
    domainConfig,
    domain: activeDomain,
    backendMode: input.backendMode ?? "hybrid",
    environments: defaultEnvironments(slug, activeDomain),
    previews: defaultPreviewConfig,
    providers: defaultProviders(slug),
    operations: defaultOperations
  };
}
