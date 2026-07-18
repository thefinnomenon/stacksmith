import { createHmac, timingSafeEqual } from "node:crypto";
import type { ActionDefinition } from "./actions.js";
import type { Incident } from "./incidents.js";

export interface SlackBlockAction {
  type: "button";
  text: { type: "plain_text"; text: string };
  value: string;
  action_id: string;
  style?: "primary" | "danger";
  url?: string;
}

export interface SlackMessage {
  channel: string;
  text: string;
  blocks: Array<Record<string, unknown>>;
}

export function buildIncidentSlackMessage(input: {
  channel: string;
  incident: Incident;
  actions: ActionDefinition[];
}): SlackMessage {
  const actionElements: SlackBlockAction[] = input.actions.slice(0, 5).map((action) => ({
    type: "button",
    text: { type: "plain_text", text: action.label },
    value: JSON.stringify({ incidentId: input.incident.id, actionId: action.id }),
    action_id: action.id,
    style: action.risk === "destructive" ? "danger" : undefined
  }));

  return {
    channel: input.channel,
    text: `${input.incident.severity.toUpperCase()}: ${input.incident.title}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${input.incident.title}*\n${input.incident.summary}`
        }
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Project: ${input.incident.projectId} | Env: ${input.incident.environment} | PR: ${input.incident.pullRequestNumber ?? "n/a"} | SHA: ${input.incident.git.sha}`
          }
        ]
      },
      {
        type: "actions",
        elements: actionElements
      }
    ]
  };
}

export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  nowSeconds?: number;
}): boolean {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const timestamp = Number(input.timestamp);

  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 60 * 5) {
    return false;
  }

  const base = `v0:${input.timestamp}:${input.rawBody}`;
  const expected = `v0=${createHmac("sha256", input.signingSecret).update(base).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(input.signature, "utf8");

  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}
