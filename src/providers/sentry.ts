import { createStubProvider } from "./stub.js";

export const sentryProvider = createStubProvider({
  id: "sentry",
  label: "Sentry",
  getConfig: (manifest) => manifest.providers.sentry,
  resources: [
    {
      kind: "project",
      name: (manifest) => `${manifest.slug}-web`
    },
    {
      kind: "project",
      name: (manifest) => `${manifest.slug}-api`
    },
    {
      kind: "tagging-policy",
      name: (manifest) => `${manifest.slug}-preview-tags`,
      metadata: () => ({ environment: "preview", tags: ["preview_id", "github_pr", "git_branch", "git_sha"] })
    }
  ],
  notes: ["Sentry scaffold records web/API projects and preview tagging policy."]
});
