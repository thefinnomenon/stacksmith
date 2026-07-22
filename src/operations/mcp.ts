import { actionRegistry } from "./actions.js";

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const mcpTools: McpToolDescriptor[] = [
  {
    name: "list_incidents",
    description: "List normalized incidents for a project and optional environment.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        environment: { type: "string", enum: ["development", "preview", "staging", "production"] }
      },
      required: ["projectId"]
    }
  },
  {
    name: "get_incident",
    description: "Read one incident with evidence references and available actions.",
    inputSchema: {
      type: "object",
      properties: { incidentId: { type: "string" } },
      required: ["incidentId"]
    }
  },
  {
    name: "collect_incident_evidence",
    description: "Refresh evidence from PostHog, Vercel, Cloud Run, GitHub, jobs, and health checks.",
    inputSchema: {
      type: "object",
      properties: { incidentId: { type: "string" } },
      required: ["incidentId"]
    }
  },
  {
    name: "execute_action",
    description: "Execute a registered control-plane action by id.",
    inputSchema: {
      type: "object",
      properties: {
        actionId: { type: "string", enum: actionRegistry.map((action) => action.id) },
        incidentId: { type: "string" }
      },
      required: ["actionId"]
    }
  },
  {
    name: "get_preview_health",
    description: "Return normalized health for a preview environment.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        previewId: { type: "string" }
      },
      required: ["projectId", "previewId"]
    }
  },
  {
    name: "get_posthog_errors",
    description: "Return normalized PostHog issues for a project, release, or preview.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        projectSlug: { type: "string" },
        environment: { type: "string", enum: ["development", "preview", "staging", "production"] },
        previewId: { type: "string" },
        release: { type: "string" }
      },
      required: ["projectId"]
    }
  },
  {
    name: "query_posthog_product_metrics",
    description: "Return PostHog product metrics filtered by project slug and environment.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        projectSlug: { type: "string" },
        fromDate: { type: "string" },
        toDate: { type: "string" },
        question: { type: "string", enum: ["retention", "activation", "conversion", "active-users", "event-count"] },
        environment: { type: "string", enum: ["development", "preview", "staging", "production"] }
      },
      required: ["projectId", "projectSlug", "fromDate", "toDate", "question"]
    }
  },
  {
    name: "search_posthog_logs",
    description: "Search PostHog logs with project and environment filters.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        projectSlug: { type: "string" },
        environment: { type: "string", enum: ["development", "preview", "staging", "production"] },
        previewId: { type: "string" },
        query: { type: "string" }
      },
      required: ["projectId", "projectSlug", "query"]
    }
  }
];

export function listMcpTools(): McpToolDescriptor[] {
  return mcpTools;
}
