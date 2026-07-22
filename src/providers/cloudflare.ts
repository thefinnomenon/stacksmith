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
      kind: "queue",
      name: (manifest) => manifest.providers.cloudflare.r2EventForwarder?.queueName ?? `${manifest.slug}-r2-events`,
      metadata: (manifest) => ({
        purpose: "r2-event-notifications",
        eventTypes: manifest.providers.cloudflare.r2EventTypes ?? ["object-create", "object-delete"]
      })
    },
    {
      kind: "worker",
      name: (manifest) => manifest.providers.cloudflare.r2EventForwarder?.workerName ?? `${manifest.slug}-r2-event-forwarder`,
      metadata: (manifest) => ({
        purpose: "r2-event-forwarder",
        endpointPath: manifest.providers.cloudflare.r2EventForwarder?.endpointPath ?? "/api/webhook/cloudflare/r2"
      })
    },
    {
      kind: "r2-event-notification-rule",
      name: (manifest) => `${manifest.slug}-r2-event-notifications`,
      metadata: (manifest) => ({
        enabled: manifest.providers.cloudflare.r2Events ?? true,
        buckets: [`${manifest.slug}-dev`, `${manifest.slug}-staging`, `${manifest.slug}-production`]
      })
    },
    {
      kind: "domain-registration",
      name: (manifest) => manifest.domain ?? "disabled-free-mode",
      metadata: (manifest) => ({ registrar: manifest.providers.cloudflare.registrar ?? false })
    }
  ],
  notes: ["Cloudflare scaffold covers DNS, R2, R2 event forwarding, tunnel, and registrar intent. Domain purchase is not implemented."]
});
