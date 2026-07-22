import type { EnvironmentName } from "../core/types.js";
import type { SlackMessage } from "./slack.js";

export type NotificationSeverity = "debug" | "info" | "warning" | "critical";

export type NotificationType =
  | "project.provisioned"
  | "preview.ready"
  | "preview.failed"
  | "deployment.failed"
  | "posthog.error_regression"
  | "stripe.payment_succeeded"
  | "stripe.webhook_failed"
  | "job.dead_lettered"
  | "user.first_signup";

export interface NotificationEvent {
  id: string;
  projectId: string;
  type: NotificationType;
  severity: NotificationSeverity;
  environment: EnvironmentName;
  title: string;
  summary: string;
  previewId?: string;
  pullRequestNumber?: number;
  links?: Array<{
    label: string;
    url: string;
  }>;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface SlackNotificationRouting {
  activityChannel: string;
  alertsChannel: string;
  previewFailuresOnly: boolean;
}

export function routeNotificationToSlack(event: NotificationEvent, routing: SlackNotificationRouting): string | undefined {
  if (event.environment === "preview") {
    if (event.severity === "critical" || event.severity === "warning" || event.type === "preview.failed") {
      return routing.alertsChannel;
    }

    return routing.previewFailuresOnly ? undefined : routing.activityChannel;
  }

  if (event.severity === "critical" || event.severity === "warning") {
    return routing.alertsChannel;
  }

  return routing.activityChannel;
}

export function buildNotificationSlackMessage(event: NotificationEvent, channel: string): SlackMessage {
  const linkText = event.links?.length
    ? `\n${event.links.map((link) => `<${link.url}|${link.label}>`).join(" | ")}`
    : "";

  return {
    channel,
    text: `${event.title}: ${event.summary}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${event.title}*\n${event.summary}${linkText}`
        }
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Project: ${event.projectId} | Env: ${event.environment} | Severity: ${event.severity} | Type: ${event.type}`
          }
        ]
      }
    ]
  };
}

export function createNotificationEvent(input: Omit<NotificationEvent, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
}): NotificationEvent {
  return {
    ...input,
    id: input.id ?? `${input.projectId}:${input.environment}:${input.type}:${Date.now()}`,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}
