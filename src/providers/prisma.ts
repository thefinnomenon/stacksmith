import { createHash } from "node:crypto";
import type {
  ApplyResult,
  HealthCheckResult,
  InspectResult,
  PlannedChange,
  ProjectManifest,
  ProjectState,
  ProviderAdapter,
  ProviderResourceState,
  ProviderState
} from "../core/types.js";

const provider = "prisma-postgres" as const;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function databaseNames(manifest: ProjectManifest): string[] {
  return [
    `${manifest.slug}-development`,
    `${manifest.slug}-staging`,
    `${manifest.slug}-production`
  ];
}

function desiredResources(manifest: ProjectManifest): ProviderResourceState[] {
  const config = manifest.providers["prisma-postgres"];
  const resources: ProviderResourceState[] = [
    {
      kind: "vercel-marketplace-integration",
      name: "prisma-postgres",
      status: "configured",
      metadata: {
        managedBy: "stacksmith",
        provider,
        via: config.via,
        billingPlan: config.billingPlan,
        region: config.region
      }
    },
    {
      kind: "vercel-marketplace-resource-connection",
      name: `${manifest.slug}-vercel-prisma-connection`,
      status: "configured",
      metadata: {
        managedBy: "stacksmith",
        provider,
        vercelProject: manifest.slug,
        injectedEnvironmentVariables: ["DATABASE_URL", "DIRECT_DATABASE_URL"]
      }
    },
    {
      kind: "migration-env-policy",
      name: "direct-database-url-for-migrations",
      status: "configured",
      metadata: {
        managedBy: "stacksmith",
        provider,
        pooledUrl: "DATABASE_URL",
        directUrl: "DIRECT_DATABASE_URL"
      }
    },
    {
      kind: "preview-database-policy",
      name: `${manifest.slug}-preview-databases`,
      status: "configured",
      metadata: {
        managedBy: "stacksmith",
        provider,
        strategy: manifest.previews.database,
        provisioning: config.previewProvisioning,
        vercelPreviewIntegration: config.previewProvisioning === "vercel-preview-env",
        isolated: manifest.previews.database === "isolated"
      }
    },
    {
      kind: "accelerate-policy",
      name: "prisma-accelerate",
      status: "configured",
      metadata: {
        managedBy: "stacksmith",
        provider,
        connectionPooling: config.acceleration?.connectionPooling ?? false,
        queryCache: config.acceleration?.queryCache ?? "disabled"
      }
    }
  ];

  for (const name of databaseNames(manifest)) {
    resources.push({
      kind: "database",
      name,
      status: "configured",
      metadata: {
        managedBy: "stacksmith",
        provider,
        region: config.region,
        via: config.via
      }
    });
  }

  return resources;
}

function providerHash(manifest: ProjectManifest): string {
  return hash({
    provider: manifest.providers["prisma-postgres"],
    previewDatabase: manifest.previews.database,
    vercelProject: manifest.slug
  });
}

function appliedState(manifest: ProjectManifest): ProviderState {
  const now = new Date().toISOString();
  return {
    provider,
    status: manifest.providers["prisma-postgres"].enabled ? "applied" : "disabled",
    appliedConfigHash: providerHash(manifest),
    resources: manifest.providers["prisma-postgres"].enabled
      ? desiredResources(manifest).map((resource) => ({ ...resource, status: "stubbed" }))
      : [],
    lastInspectedAt: now,
    lastAppliedAt: now
  };
}

export const prismaProvider: ProviderAdapter = {
  id: provider,
  label: "Prisma Postgres",

  async inspect(manifest, state): Promise<InspectResult> {
    if (!manifest.providers["prisma-postgres"].enabled) {
      return {
        provider,
        enabled: false,
        resources: [],
        messages: ["Prisma Postgres disabled in manifest."]
      };
    }

    return {
      provider,
      enabled: true,
      resources: state.providers["prisma-postgres"]?.resources.length
        ? state.providers["prisma-postgres"].resources
        : desiredResources(manifest).map((resource) => ({ ...resource, status: "missing" })),
      messages: [
        "Prisma inspection is local state only in Phase 1.",
        "The default model is Prisma Postgres through Vercel Marketplace, with DATABASE_URL and DIRECT_DATABASE_URL treated as the app/migration contract.",
        "Live database creation is exposed as guarded command plans, not provider lifecycle side effects."
      ]
    };
  },

  async plan(manifest, state): Promise<PlannedChange[]> {
    if (!manifest.providers["prisma-postgres"].enabled) {
      return [{
        id: "prisma-postgres:disabled",
        provider,
        action: "noop",
        risk: "read-only",
        summary: "Prisma Postgres is disabled."
      }];
    }

    const current = state.providers["prisma-postgres"];
    const nextHash = providerHash(manifest);
    const resources = desiredResources(manifest);

    if (!current || current.status === "unconfigured") {
      return [
        {
          id: "prisma-postgres:create-marketplace-spine",
          provider,
          action: "create",
          risk: "reversible",
          summary: "Record Prisma Postgres marketplace, database, preview, and migration scaffold state.",
          details: {
            commandPlanProvider: provider,
            resources,
            boundary: "Marketplace billing authorization and store creation require explicit external command execution."
          }
        }
      ];
    }

    if (current.appliedConfigHash !== nextHash) {
      return [
        {
          id: "prisma-postgres:update-marketplace-spine",
          provider,
          action: "update",
          risk: "reversible",
          summary: "Update Prisma Postgres scaffold state to match the manifest.",
          details: {
            commandPlanProvider: provider,
            resources
          }
        }
      ];
    }

    return [
      {
        id: "prisma-postgres:noop",
        provider,
        action: "noop",
        risk: "read-only",
        summary: "Prisma Postgres scaffold state matches the manifest."
      }
    ];
  },

  async apply(manifest, state, changes): Promise<ApplyResult> {
    const scoped = changes.filter((change) => change.provider === provider);
    const actionable = scoped.filter((change) => change.action !== "noop");
    const nextState = appliedState(manifest);
    state.providers["prisma-postgres"] = nextState;

    return {
      provider,
      applied: actionable,
      skipped: scoped.filter((change) => change.action === "noop"),
      messages: [
        "Prisma Postgres scaffold state updated locally.",
        "No Prisma or Vercel Marketplace API calls were made. Use `stacksmith commands --provider prisma-postgres` for guarded external steps."
      ],
      state: nextState
    };
  },

  async health(manifest, state): Promise<HealthCheckResult> {
    if (!manifest.providers["prisma-postgres"].enabled) {
      return {
        provider,
        status: "unknown",
        checks: [{ name: "enabled", status: "unknown", message: "Prisma Postgres is disabled." }]
      };
    }

    const current = state.providers["prisma-postgres"];
    if (!current || current.status !== "applied") {
      return {
        provider,
        status: "missing",
        checks: [{ name: "state", status: "missing", message: "Prisma Postgres scaffold state has not been applied locally." }]
      };
    }

    const hasMarketplace = current.resources.some((resource) => resource.kind === "vercel-marketplace-integration");
    const hasDatabases = databaseNames(manifest).every((name) => (
      current.resources.some((resource) => resource.kind === "database" && resource.name === name)
    ));
    const hasPreviewPolicy = current.resources.some((resource) => resource.kind === "preview-database-policy");
    const hasMigrationPolicy = current.resources.some((resource) => resource.kind === "migration-env-policy");

    return {
      provider,
      status: hasMarketplace && hasDatabases && hasPreviewPolicy && hasMigrationPolicy ? "healthy" : "degraded",
      checks: [
        {
          name: "marketplace",
          status: hasMarketplace ? "healthy" : "missing",
          message: hasMarketplace
            ? "Prisma Vercel Marketplace integration scaffold is recorded."
            : "Prisma marketplace scaffold is missing."
        },
        {
          name: "databases",
          status: hasDatabases ? "healthy" : "missing",
          message: hasDatabases
            ? "Development, staging, and production database intent is recorded."
            : "One or more database resources are missing from local state."
        },
        {
          name: "previews",
          status: hasPreviewPolicy ? "healthy" : "missing",
          message: hasPreviewPolicy
            ? `Preview database strategy is ${manifest.previews.database}.`
            : "Preview database policy is missing."
        },
        {
          name: "migrations",
          status: hasMigrationPolicy ? "healthy" : "missing",
          message: hasMigrationPolicy
            ? "Migration policy requires DIRECT_DATABASE_URL separately from pooled DATABASE_URL."
            : "Migration environment policy is missing."
        },
        {
          name: "api",
          status: "unknown",
          message: "Live Prisma/Vercel Marketplace health is not implemented in Phase 1."
        }
      ]
    };
  }
};
