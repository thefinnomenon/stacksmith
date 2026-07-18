import type { EnvironmentName } from "../core/types.js";
import type { Incident } from "./incidents.js";

export interface ActionContext {
  actor: {
    id: string;
    type: "user" | "ai" | "system" | "slack";
  };
  environment: EnvironmentName;
  incident?: Incident;
  payload?: Record<string, unknown>;
}

export interface ActionResult {
  id: string;
  status: "accepted" | "completed" | "rejected" | "not-implemented";
  message: string;
  auditMetadata?: Record<string, unknown>;
}

export interface ActionDefinition {
  id: string;
  label: string;
  description: string;
  risk: "read-only" | "reversible" | "production-write" | "destructive";
  allowedEnvironments: EnvironmentName[];
  execute(context: ActionContext): Promise<ActionResult>;
}

function notImplemented(id: string, message: string): ActionDefinition["execute"] {
  return async () => ({
    id,
    status: "not-implemented",
    message
  });
}

export const actionRegistry: ActionDefinition[] = [
  {
    id: "incident.open_sentry",
    label: "Open Sentry",
    description: "Return the linked Sentry issue URL for an incident.",
    risk: "read-only",
    allowedEnvironments: ["development", "preview", "staging", "production"],
    execute: async (context) => {
      const sentry = context.incident?.evidence.find((item) => item.type === "sentry-issue");
      return sentry
        ? { id: "incident.open_sentry", status: "completed", message: sentry.url }
        : { id: "incident.open_sentry", status: "rejected", message: "Incident has no Sentry evidence." };
    }
  },
  {
    id: "incident.view_logs",
    label: "View Logs",
    description: "Collect provider log references for an incident.",
    risk: "read-only",
    allowedEnvironments: ["development", "preview", "staging", "production"],
    execute: async (context) => ({
      id: "incident.view_logs",
      status: "completed",
      message: `Found ${context.incident?.evidence.filter((item) => item.type.endsWith("logs") || item.type === "vercel-build").length ?? 0} log references.`
    })
  },
  {
    id: "incident.ask_ai_to_diagnose",
    label: "Ask AI to Diagnose",
    description: "Queue an AI diagnosis job with the normalized incident bundle.",
    risk: "reversible",
    allowedEnvironments: ["development", "preview", "staging", "production"],
    execute: notImplemented("incident.ask_ai_to_diagnose", "AI diagnosis job enqueueing is a Phase 2 implementation.")
  },
  {
    id: "incident.ask_ai_to_fix",
    label: "Ask AI to Fix",
    description: "Queue a bounded AI fix attempt for a preview or staging incident.",
    risk: "reversible",
    allowedEnvironments: ["preview", "staging"],
    execute: notImplemented("incident.ask_ai_to_fix", "AI fix orchestration is a Phase 2 implementation.")
  },
  {
    id: "deployment.retry",
    label: "Retry Deployment",
    description: "Retry a failed Vercel or Cloud Run deployment.",
    risk: "reversible",
    allowedEnvironments: ["development", "preview", "staging"],
    execute: notImplemented("deployment.retry", "Deployment retries require provider API adapters.")
  },
  {
    id: "job.retry",
    label: "Retry Job",
    description: "Retry a failed Postgres-backed job.",
    risk: "reversible",
    allowedEnvironments: ["development", "preview", "staging", "production"],
    execute: notImplemented("job.retry", "Job retry execution will be wired to the job runner.")
  },
  {
    id: "incident.resolve",
    label: "Resolve",
    description: "Mark an incident resolved after verification.",
    risk: "reversible",
    allowedEnvironments: ["development", "preview", "staging", "production"],
    execute: async () => ({
      id: "incident.resolve",
      status: "not-implemented",
      message: "Incident persistence is defined, but write execution is not implemented yet."
    })
  }
];

export function getAction(id: string): ActionDefinition {
  const action = actionRegistry.find((candidate) => candidate.id === id);

  if (!action) {
    throw new Error(`Unknown action: ${id}`);
  }

  return action;
}

export function actionsForIncident(incident: Incident): ActionDefinition[] {
  return actionRegistry.filter((action) => action.allowedEnvironments.includes(incident.environment));
}
