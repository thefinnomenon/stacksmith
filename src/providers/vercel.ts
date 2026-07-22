import { createHash } from "node:crypto";
import { envContract } from "../core/env-contract.js";
import type {
  ApplyResult,
  EnvironmentName,
  HealthCheckResult,
  InspectResult,
  PlannedChange,
  ProjectManifest,
  ProjectState,
  ProviderAdapter,
  ProviderResourceState,
  ProviderState
} from "../core/types.js";

const provider = "vercel" as const;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function enabledEnvironmentNames(): EnvironmentName[] {
  return ["development", "preview", "staging", "production"];
}

function vercelEnvironment(environment: EnvironmentName): "development" | "preview" | "production" {
  if (environment === "production") {
    return "production";
  }

  if (environment === "development") {
    return "development";
  }

  return "preview";
}

function environmentMetadata(environment: EnvironmentName): Record<string, unknown> {
  return {
    stacksmithEnvironment: environment,
    vercelEnvironment: vercelEnvironment(environment),
    gitBranch: environment === "staging" ? "staging" : undefined
  };
}

function requiredEnvFor(environment: EnvironmentName): string[] {
  return envContract
    .filter((variable) => variable.requiredIn.includes(environment))
    .map((variable) => variable.name);
}

function desiredResources(manifest: ProjectManifest): ProviderResourceState[] {
  const resources: ProviderResourceState[] = [
    {
      kind: "project",
      name: manifest.slug,
      status: "configured",
      url: manifest.environments.production.appUrl,
      metadata: {
        managedBy: "stacksmith",
        provider,
        team: manifest.providers.vercel.team,
        gitRepository: manifest.providers.github.owner
          ? `${manifest.providers.github.owner}/${manifest.slug}`
          : undefined
      }
    }
  ];

  for (const environment of enabledEnvironmentNames()) {
    resources.push({
      kind: "deployment-environment",
      name: `${manifest.slug}-${environment}`,
      status: "configured",
      url: manifest.environments[environment].appUrl,
      metadata: {
        managedBy: "stacksmith",
        provider,
        ...environmentMetadata(environment),
        apiUrl: manifest.environments[environment].apiUrl,
        filesUrl: manifest.environments[environment].filesUrl
      }
    });

    resources.push({
      kind: "env-contract",
      name: `${environment}-environment-variables`,
      status: "configured",
      metadata: {
        managedBy: "stacksmith",
        provider,
        ...environmentMetadata(environment),
        required: requiredEnvFor(environment)
      }
    });
  }

  if (manifest.domain) {
    resources.push({
      kind: "domain-attachment",
      name: manifest.domain,
      status: "configured",
      url: `https://${manifest.domain}`,
      metadata: {
        managedBy: "stacksmith",
        provider,
        domainMode: manifest.domainMode,
        dnsProvider: "cloudflare"
      }
    });
  }

  return resources;
}

function providerHash(manifest: ProjectManifest): string {
  return hash({
    provider: manifest.providers.vercel,
    environments: manifest.environments,
    domain: manifest.domain,
    domainMode: manifest.domainMode,
    github: {
      owner: manifest.providers.github.owner,
      private: manifest.providers.github.private
    }
  });
}

function appliedState(manifest: ProjectManifest): ProviderState {
  const now = new Date().toISOString();
  return {
    provider,
    status: manifest.providers.vercel.enabled ? "applied" : "disabled",
    appliedConfigHash: providerHash(manifest),
    resources: manifest.providers.vercel.enabled
      ? desiredResources(manifest).map((resource) => ({ ...resource, status: "stubbed" }))
      : [],
    lastInspectedAt: now,
    lastAppliedAt: now
  };
}

export const vercelProvider: ProviderAdapter = {
  id: provider,
  label: "Vercel",

  async inspect(manifest, state): Promise<InspectResult> {
    if (!manifest.providers.vercel.enabled) {
      return {
        provider,
        enabled: false,
        resources: [],
        messages: ["Vercel disabled in manifest."]
      };
    }

    return {
      provider,
      enabled: true,
      resources: state.providers.vercel?.resources.length
        ? state.providers.vercel.resources
        : desiredResources(manifest).map((resource) => ({ ...resource, status: "missing" })),
      messages: [
        "Vercel inspection is local state only in Phase 1.",
        "Command plans cover project creation/linking, environment variables, domain attachment, and local env pull."
      ]
    };
  },

  async plan(manifest, state): Promise<PlannedChange[]> {
    if (!manifest.providers.vercel.enabled) {
      return [{
        id: "vercel:disabled",
        provider,
        action: "noop",
        risk: "read-only",
        summary: "Vercel is disabled."
      }];
    }

    const current = state.providers.vercel;
    const nextHash = providerHash(manifest);
    const resources = desiredResources(manifest);

    if (!current || current.status === "unconfigured") {
      return [
        {
          id: "vercel:create-project-spine",
          provider,
          action: "create",
          risk: "reversible",
          summary: "Record Vercel project, environment, domain, and env-contract scaffold state.",
          details: {
            commandPlanProvider: "vercel",
            resources
          }
        }
      ];
    }

    if (current.appliedConfigHash !== nextHash) {
      return [
        {
          id: "vercel:update-project-spine",
          provider,
          action: "update",
          risk: "reversible",
          summary: "Update Vercel scaffold state to match the manifest.",
          details: {
            commandPlanProvider: "vercel",
            resources
          }
        }
      ];
    }

    return [
      {
        id: "vercel:noop",
        provider,
        action: "noop",
        risk: "read-only",
        summary: "Vercel scaffold state matches the manifest."
      }
    ];
  },

  async apply(manifest, state, changes): Promise<ApplyResult> {
    const scoped = changes.filter((change) => change.provider === provider);
    const actionable = scoped.filter((change) => change.action !== "noop");
    const nextState = appliedState(manifest);
    state.providers.vercel = nextState;

    return {
      provider,
      applied: actionable,
      skipped: scoped.filter((change) => change.action === "noop"),
      messages: [
        "Vercel scaffold state updated locally.",
        "No Vercel API calls were made. Use `stacksmith commands --provider vercel` to inspect executable command plans."
      ],
      state: nextState
    };
  },

  async health(manifest, state): Promise<HealthCheckResult> {
    if (!manifest.providers.vercel.enabled) {
      return {
        provider,
        status: "unknown",
        checks: [{ name: "enabled", status: "unknown", message: "Vercel is disabled." }]
      };
    }

    const current = state.providers.vercel;
    if (!current || current.status !== "applied") {
      return {
        provider,
        status: "missing",
        checks: [{ name: "state", status: "missing", message: "Vercel scaffold state has not been applied locally." }]
      };
    }

    const hasProject = current.resources.some((resource) => resource.kind === "project");
    const hasEnvContracts = enabledEnvironmentNames().every((environment) => (
      current.resources.some((resource) => resource.kind === "env-contract" && resource.name === `${environment}-environment-variables`)
    ));

    return {
      provider,
      status: hasProject && hasEnvContracts ? "healthy" : "degraded",
      checks: [
        {
          name: "project",
          status: hasProject ? "healthy" : "missing",
          message: hasProject ? "Vercel project scaffold is recorded." : "Vercel project scaffold is missing."
        },
        {
          name: "env-contract",
          status: hasEnvContracts ? "healthy" : "missing",
          message: hasEnvContracts
            ? "Vercel environment variable contracts are recorded for development, preview, staging, and production."
            : "One or more Vercel environment contracts are missing."
        },
        {
          name: "api",
          status: "unknown",
          message: "Live Vercel API health is not implemented in Phase 1."
        }
      ]
    };
  }
};
