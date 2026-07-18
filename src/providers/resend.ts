import { createStubProvider } from "./stub.js";

export const resendProvider = createStubProvider({
  id: "resend",
  label: "Resend",
  getConfig: (manifest) => manifest.providers.resend,
  resources: [
    {
      kind: "sending-domain",
      name: (manifest) => manifest.domain ?? `${manifest.slug}.example.com`
    },
    {
      kind: "email-route",
      name: (manifest) => `hello@${manifest.domain ?? `${manifest.slug}.example.com`}`
    }
  ],
  notes: ["Resend scaffold models sending domain and inbound forwarding requirements."]
});
