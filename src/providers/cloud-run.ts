import { createStubProvider } from "./stub.js";

export const cloudRunProvider = createStubProvider({
  id: "cloud-run",
  label: "Google Cloud Run",
  getConfig: (manifest) => manifest.providers["cloud-run"],
  resources: [
    {
      kind: "service",
      name: (manifest) => `${manifest.slug}-api`,
      url: (manifest) => manifest.environments.production.apiUrl
    },
    {
      kind: "job",
      name: (manifest) => `${manifest.slug}-worker`
    },
    {
      kind: "job",
      name: (manifest) => `${manifest.slug}-maintenance`
    },
    {
      kind: "scheduler",
      name: (manifest) => `${manifest.slug}-scheduled-jobs`
    },
    {
      kind: "preview-service-template",
      name: (manifest) => `${manifest.slug}-api-preview`,
      metadata: (manifest) => ({ enabled: manifest.previews.backend === "isolated" })
    }
  ],
  notes: ["Cloud Run scaffold covers scale-to-zero API services, jobs, scheduled tasks, and preview service intent."]
});
