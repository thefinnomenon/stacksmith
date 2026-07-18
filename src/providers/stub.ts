import { createHash } from "node:crypto";
import type {
  ApplyResult,
  HealthCheckResult,
  InspectResult,
  PlannedChange,
  ProjectManifest,
  ProjectState,
  ProviderAdapter,
  ProviderConfig,
  ProviderId,
  ProviderResourceState,
  ProviderState
} from "../core/types.js";

export interface ResourceTemplate {
  kind: string;
  name(manifest: ProjectManifest): string;
  url?(manifest: ProjectManifest): string | undefined;
  metadata?(manifest: ProjectManifest): Record<string, unknown>;
}

export interface StubProviderOptions {
  id: ProviderId;
  label: string;
  getConfig(manifest: ProjectManifest): ProviderConfig;
  resources: ResourceTemplate[];
  notes?: string[];
}

function configHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function desiredResources(options: StubProviderOptions, manifest: ProjectManifest): ProviderResourceState[] {
  return options.resources.map((resource) => ({
    kind: resource.kind,
    name: resource.name(manifest),
    status: "configured",
    url: resource.url?.(manifest),
    metadata: {
      managedBy: "stacksmith",
      provider: options.id,
      ...(resource.metadata?.(manifest) ?? {})
    }
  }));
}

export function createStubProvider(options: StubProviderOptions): ProviderAdapter {
  return {
    id: options.id,
    label: options.label,

    async inspect(manifest, state): Promise<InspectResult> {
      const providerConfig = options.getConfig(manifest);
      const providerState = state.providers[options.id];

      if (!providerConfig.enabled) {
        return {
          provider: options.id,
          enabled: false,
          resources: [],
          messages: [`${options.label} disabled in manifest.`]
        };
      }

      const resources: ProviderResourceState[] = providerState?.resources.length ? providerState.resources : desiredResources(options, manifest).map((resource) => ({
        ...resource,
        status: "missing" as const
      }));

      return {
        provider: options.id,
        enabled: true,
        resources,
        messages: options.notes ?? [`${options.label} uses local scaffold inspection only.`]
      };
    },

    async plan(manifest, state): Promise<PlannedChange[]> {
      const providerConfig = options.getConfig(manifest);
      const providerState = state.providers[options.id];
      const hash = configHash(providerConfig);

      if (!providerConfig.enabled) {
        return [
          {
            id: `${options.id}:disabled`,
            provider: options.id,
            action: "noop",
            risk: "read-only",
            summary: `${options.label} is disabled.`
          }
        ];
      }

      if (!providerState || providerState.status === "unconfigured") {
        return [
          {
            id: `${options.id}:create-scaffold`,
            provider: options.id,
            action: "create",
            risk: "reversible",
            summary: `Record local scaffold state for ${options.label}.`,
            details: {
              implementation: "stub",
              resources: desiredResources(options, manifest)
            }
          }
        ];
      }

      if (providerState.appliedConfigHash !== hash) {
        return [
          {
            id: `${options.id}:update-scaffold`,
            provider: options.id,
            action: "update",
            risk: "reversible",
            summary: `Update local scaffold state for ${options.label}.`,
            details: {
              implementation: "stub",
              resources: desiredResources(options, manifest)
            }
          }
        ];
      }

      return [
        {
          id: `${options.id}:noop`,
          provider: options.id,
          action: "noop",
          risk: "read-only",
          summary: `${options.label} scaffold state matches the manifest.`
        }
      ];
    },

    async apply(manifest, state, changes): Promise<ApplyResult> {
      const actionable = changes.filter((change) => change.provider === options.id && change.action !== "noop");
      const providerConfig = options.getConfig(manifest);
      const now = new Date().toISOString();
      const providerState: ProviderState = {
        provider: options.id,
        status: providerConfig.enabled ? "applied" : "disabled",
        appliedConfigHash: configHash(providerConfig),
        resources: providerConfig.enabled ? desiredResources(options, manifest).map((resource) => ({
          ...resource,
          status: "stubbed" as const
        })) : [],
        lastInspectedAt: now,
        lastAppliedAt: now
      };

      state.providers[options.id] = providerState;

      return {
        provider: options.id,
        applied: actionable,
        skipped: changes.filter((change) => change.provider === options.id && change.action === "noop"),
        messages: [
          `${options.label} scaffold state updated locally.`,
          "No real provider API calls were made."
        ],
        state: providerState
      };
    },

    async health(manifest, state): Promise<HealthCheckResult> {
      const providerConfig = options.getConfig(manifest);
      const providerState = state.providers[options.id];

      if (!providerConfig.enabled) {
        return {
          provider: options.id,
          status: "unknown",
          checks: [{ name: "enabled", status: "unknown", message: `${options.label} is disabled.` }]
        };
      }

      if (!providerState || providerState.status !== "applied") {
        return {
          provider: options.id,
          status: "missing",
          checks: [{ name: "state", status: "missing", message: `${options.label} has not been applied locally.` }]
        };
      }

      return {
        provider: options.id,
        status: "healthy",
        checks: [
          { name: "state", status: "healthy", message: `${options.label} scaffold state exists.` },
          { name: "api", status: "unknown", message: "Real provider API health is not implemented in Phase 1." }
        ]
      };
    }
  };
}
