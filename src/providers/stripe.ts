import { createStubProvider } from "./stub.js";

export const stripeProvider = createStubProvider({
  id: "stripe",
  label: "Stripe",
  getConfig: (manifest) => manifest.providers.stripe,
  resources: [
    {
      kind: "test-mode-webhook",
      name: (manifest) => `${manifest.slug}-stripe-test`,
      url: (manifest) => manifest.environments.staging.stripeWebhookUrl
    },
    {
      kind: "preview-router",
      name: (manifest) => `${manifest.slug}-stripe-preview-router`,
      url: (manifest) => manifest.environments.preview.stripeWebhookUrl
    }
  ],
  notes: ["Stripe scaffold includes shared test webhook and preview router intent. Live mode is intentionally absent."]
});
