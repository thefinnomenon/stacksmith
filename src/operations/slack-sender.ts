import type { SlackMessage } from "./slack.js";

export interface SlackSendResult {
  status: "planned" | "sent" | "failed" | "skipped";
  message: string;
  channel: string;
  response?: unknown;
}

export async function sendSlackMessage(input: {
  message: SlackMessage;
  botToken?: string;
  execute: boolean;
  fetchImpl?: typeof fetch;
}): Promise<SlackSendResult> {
  if (!input.execute) {
    return {
      status: "planned",
      channel: input.message.channel,
      message: `Prepared Slack message for ${input.message.channel}.`
    };
  }

  if (!input.botToken) {
    return {
      status: "skipped",
      channel: input.message.channel,
      message: "SLACK_BOT_TOKEN is not set."
    };
  }

  const fetcher = input.fetchImpl ?? fetch;
  const response = await fetcher("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.botToken}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(input.message)
  });
  const payload = await response.json() as { ok?: boolean; error?: string };

  if (!response.ok || !payload.ok) {
    return {
      status: "failed",
      channel: input.message.channel,
      message: payload.error ?? `Slack API returned HTTP ${response.status}.`,
      response: payload
    };
  }

  return {
    status: "sent",
    channel: input.message.channel,
    message: `Sent Slack message to ${input.message.channel}.`,
    response: payload
  };
}
