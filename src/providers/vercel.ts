import { createStubProvider } from "./stub.js";

export const vercelProvider = createStubProvider({
  id: "vercel",
  label: "Vercel",
  getConfig: (manifest) => manifest.providers.vercel,
  resources: [
    {
      kind: "project",
      name: (manifest) => manifest.slug,
      url: (manifest) => manifest.environments.production.appUrl
    },
    {
      kind: "preview-environment",
      name: (manifest) => `${manifest.slug}-preview`,
      metadata: (manifest) => ({ appUrl: manifest.environments.preview.appUrl })
    }
  ],
  notes: ["Vercel scaffold models production, staging, and preview environment variables only."]
});
