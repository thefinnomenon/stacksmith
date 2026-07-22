import { createStubProvider } from "./stub.js";

export const posthogProvider = createStubProvider({
  id: "posthog",
  label: "PostHog",
  getConfig: (manifest) => manifest.providers.posthog,
  resources: [
    {
      kind: "project-allocation",
      name: (manifest) => manifest.providers.posthog.allocation === "dedicated"
        ? manifest.providers.posthog.projectName ?? `${manifest.slug}-posthog`
        : manifest.providers.posthog.sharedProjectName ?? "stacksmith-incubator",
      metadata: (manifest) => ({
        allocation: manifest.providers.posthog.allocation ?? "shared-incubator",
        project_slug: manifest.slug
      })
    },
    {
      kind: "analytics",
      name: (manifest) => `${manifest.slug}-analytics`,
      metadata: (manifest) => ({
        enabled: manifest.providers.posthog.analytics ?? true,
        required_properties: ["project_slug", "app_environment", "preview_id", "git_sha"]
      })
    },
    {
      kind: "error-tracking",
      name: (manifest) => `${manifest.slug}-errors`,
      metadata: (manifest) => ({
        enabled: manifest.providers.posthog.errorTracking ?? true,
        preview_tagging: manifest.providers.posthog.previewTagging ?? true
      })
    },
    {
      kind: "logs",
      name: (manifest) => `${manifest.slug}-logs`,
      metadata: (manifest) => ({
        enabled: manifest.providers.posthog.logs ?? true,
        correlation: ["request_id", "job_id", "stripe_event_id", "incident_id"]
      })
    },
    {
      kind: "session-replay",
      name: (manifest) => `${manifest.slug}-replay`,
      metadata: (manifest) => ({ mode: manifest.providers.posthog.sessionReplay ?? "production-sampled" })
    },
    {
      kind: "feature-flags",
      name: (manifest) => `${manifest.slug}-flags`,
      metadata: (manifest) => ({ enabled: manifest.providers.posthog.flags ?? true })
    },
    {
      kind: "slack-routing-policy",
      name: (manifest) => `${manifest.slug}-slack-posthog-routing`,
      metadata: (manifest) => ({
        alertsChannel: manifest.providers.slack.alertsChannel ?? `${manifest.slug}-alerts`,
        activityChannel: manifest.providers.slack.activityChannel ?? manifest.slug,
        route_by_project_slug: manifest.providers.posthog.slackRoutingTags ?? true
      })
    }
  ],
  notes: [
    "PostHog scaffold is the default observability adapter for analytics, errors, logs, replay, and flags.",
    "New apps use a shared incubator PostHog project until promoted to a dedicated project."
  ]
});
