import { createStubProvider } from "./stub.js";

export const mixpanelProvider = createStubProvider({
  id: "mixpanel",
  label: "Mixpanel",
  getConfig: (manifest) => manifest.providers.mixpanel,
  resources: [
    {
      kind: "project",
      name: (manifest) => `${manifest.slug}-production`
    },
    {
      kind: "project",
      name: (manifest) => `${manifest.slug}-staging`
    }
  ],
  notes: ["Mixpanel scaffold defaults preview analytics to disabled to avoid polluted analytics."]
});
