import { createStubProvider } from "./stub.js";

export const githubProvider = createStubProvider({
  id: "github",
  label: "GitHub",
  getConfig: (manifest) => manifest.providers.github,
  resources: [
    {
      kind: "repository",
      name: (manifest) => `${manifest.providers.github.owner ?? "owner"}/${manifest.slug}`,
      metadata: (manifest) => ({ private: manifest.providers.github.private ?? true })
    },
    {
      kind: "workflow",
      name: () => "preview-orchestrator.yml"
    }
  ],
  notes: ["GitHub scaffold tracks repository and workflow intent. Real gh/API provisioning is not implemented."]
});
