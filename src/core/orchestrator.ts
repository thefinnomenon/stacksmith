import { providers } from "../providers/index.js";
import type { HealthCheckResult, PlanResult, PlannedChange, ProjectManifest, ProjectState, ProviderId } from "./types.js";

export async function inspectAll(manifest: ProjectManifest, state: ProjectState) {
  return Promise.all(providers.map((provider) => provider.inspect(manifest, state)));
}

export async function planAll(manifest: ProjectManifest, state: ProjectState): Promise<PlanResult> {
  const changes = (await Promise.all(providers.map((provider) => provider.plan(manifest, state)))).flat();
  const actionable = changes.filter((change) => change.action !== "noop");

  return {
    project: manifest.slug,
    changes,
    messages: [
      actionable.length
        ? `${actionable.length} actionable scaffold change(s) planned.`
        : "No actionable scaffold changes. State matches manifest."
    ]
  };
}

export async function applyAll(manifest: ProjectManifest, state: ProjectState, changes: PlannedChange[]) {
  const results = [];

  for (const provider of providers) {
    const providerChanges = changes.filter((change) => change.provider === provider.id);
    if (providerChanges.length === 0) {
      continue;
    }

    results.push(await provider.apply(manifest, state, providerChanges));
  }

  return results;
}

export async function healthAll(manifest: ProjectManifest, state: ProjectState): Promise<HealthCheckResult[]> {
  return Promise.all(providers.map((provider) => provider.health(manifest, state)));
}

export function filterProviderChanges(changes: PlannedChange[], ids: ProviderId[] | undefined): PlannedChange[] {
  if (!ids?.length) {
    return changes;
  }

  return changes.filter((change) => ids.includes(change.provider));
}
