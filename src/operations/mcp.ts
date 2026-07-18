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
    description: "Refresh evidence from Sentry, Vercel, Cloud Run, GitHub, jobs, and health checks.",
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
    name: "get_sentry_errors",
    description: "Return normalized Sentry issues for a project, release, or preview.",
    inputSchema: {
      type: "object",
      properties: {
        organizationSlug: { type: "string" },
        projectSlug: { type: "string" },
        environment: { type: "string", enum: ["development", "preview", "staging", "production"] },
        previewId: { type: "string" },
        release: { type: "string" }
      },
      required: ["organizationSlug"]
    }
  },
  {
    name: "get_mixpanel_retention",
    description: "Return retention metrics through the Mixpanel facade.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        fromDate: { type: "string" },
        toDate: { type: "string" },
        bornEvent: { type: "string" },
        returningEvent: { type: "string" },
        environment: { type: "string", enum: ["development", "preview", "staging", "production"] }
      },
      required: ["projectId", "fromDate", "toDate", "bornEvent", "returningEvent"]
    }
  }
];

export function listMcpTools(): McpToolDescriptor[] {
  return mcpTools;
}
