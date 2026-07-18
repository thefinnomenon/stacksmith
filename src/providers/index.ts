import type { ProviderAdapter, ProviderId } from "../core/types.js";
import { cloudRunProvider } from "./cloud-run.js";
import { cloudflareProvider } from "./cloudflare.js";
import { githubProvider } from "./github.js";
import { mixpanelProvider } from "./mixpanel.js";
import { prismaProvider } from "./prisma.js";
import { resendProvider } from "./resend.js";
import { sentryProvider } from "./sentry.js";
import { slackProvider } from "./slack.js";
import { stripeProvider } from "./stripe.js";
import { vercelProvider } from "./vercel.js";

export const providers: ProviderAdapter[] = [
  githubProvider,
  vercelProvider,
  cloudRunProvider,
  prismaProvider,
  cloudflareProvider,
  resendProvider,
  stripeProvider,
  sentryProvider,
  mixpanelProvider,
  slackProvider
];

export function getProvider(id: ProviderId): ProviderAdapter {
  const provider = providers.find((candidate) => candidate.id === id);

  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }

  return provider;
}
