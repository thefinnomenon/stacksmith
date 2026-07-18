import { createStubProvider } from "./stub.js";

export const slackProvider = createStubProvider({
  id: "slack",
  label: "Slack",
  getConfig: (manifest) => manifest.providers.slack,
  resources: [
    {
      kind: "channel",
      name: (manifest) => `#${manifest.providers.slack.activityChannel ?? manifest.slug}`
    },
    {
      kind: "channel",
      name: (manifest) => `#${manifest.providers.slack.alertsChannel ?? `${manifest.slug}-alerts`}`
    },
    {
      kind: "interactive-actions",
      name: (manifest) => `${manifest.slug}-slack-actions`,
      metadata: (manifest) => manifest.operations.slackActions
    }
  ],
  notes: ["Slack scaffold models project channels and incident action buttons. No Slack API calls are made."]
});
