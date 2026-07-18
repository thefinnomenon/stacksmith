import { createStubProvider } from "./stub.js";

export const cloudflareProvider = createStubProvider({
  id: "cloudflare",
  label: "Cloudflare",
  getConfig: (manifest) => manifest.providers.cloudflare,
  resources: [
    {
      kind: "zone",
      name: (manifest) => manifest.domain ?? "free-provider-urls"
    },
    {
      kind: "r2-bucket",
      name: (manifest) => `${manifest.slug}-dev`
    },
    {
      kind: "r2-bucket",
      name: (manifest) => `${manifest.slug}-staging`
    },
    {
      kind: "r2-bucket",
      name: (manifest) => `${manifest.slug}-production`
    },
    {
      kind: "tunnel",
      name: (manifest) => `${manifest.slug}-development`
    },
    {
      kind: "domain-registration",
      name: (manifest) => manifest.domain ?? "disabled-free-mode",
      metadata: (manifest) => ({ registrar: manifest.providers.cloudflare.registrar ?? false })
    }
  ],
  notes: ["Cloudflare scaffold covers DNS, R2, tunnel, and registrar intent. Domain purchase is not implemented."]
});
