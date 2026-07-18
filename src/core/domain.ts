import { createDomainConfig, defaultEnvironments } from "./defaults.js";
import type { EnvironmentName, ProjectManifest } from "./types.js";

export interface DomainPromotionPlan {
  project: string;
  from: ProjectManifest["domainConfig"];
  to: ProjectManifest["domainConfig"];
  urlChanges: Array<{
    environment: EnvironmentName;
    key: keyof ProjectManifest["environments"][EnvironmentName];
    from?: string;
    to?: string;
  }>;
  envVarsToSync: string[];
  providerActions: string[];
  manualActions: string[];
}

export function planDomainPromotion(manifest: ProjectManifest, apexDomain: string): DomainPromotionPlan {
  const to = createDomainConfig({ domain: apexDomain });
  const nextEnvironments = defaultEnvironments(manifest.slug, to.activeDomain);
  const urlChanges: DomainPromotionPlan["urlChanges"] = [];

  for (const environment of Object.keys(manifest.environments) as EnvironmentName[]) {
    const current = manifest.environments[environment];
    const next = nextEnvironments[environment];

    for (const key of Object.keys(next) as Array<keyof typeof next>) {
      if (current[key] !== next[key]) {
        urlChanges.push({
          environment,
          key,
          from: current[key],
          to: next[key]
        });
      }
    }
  }

  return {
    project: manifest.slug,
    from: manifest.domainConfig,
    to,
    urlChanges,
    envVarsToSync: [
      "APP_URL",
      "API_URL",
      "FILES_URL",
      "AUTH_CALLBACK_URL",
      "EMAIL_LINK_BASE_URL",
      "STRIPE_WEBHOOK_URL",
      "NEXT_PUBLIC_SENTRY_DSN",
      "NEXT_PUBLIC_MIXPANEL_TOKEN"
    ],
    providerActions: [
      "Create or verify Cloudflare zone and DNS records.",
      "Add Vercel production and staging domains.",
      "Map Cloud Run API custom domains.",
      "Connect R2 custom domains for files hosts.",
      "Create or update Resend sending domain.",
      "Create new Stripe webhook endpoint and keep the old endpoint during cutover.",
      "Sync Vercel and Cloud Run environment variables."
    ],
    manualActions: [
      `Add OAuth redirect URI: https://${apexDomain}/api/auth/callback/google`,
      `Add OAuth redirect URI: https://staging.${apexDomain}/api/auth/callback/google`,
      `Add OAuth redirect URI: https://dev.${apexDomain}/api/auth/callback/google`,
      "Repeat callback updates for GitHub, Facebook, X/Twitter, or other enabled social providers."
    ]
  };
}

export function formatDomainPromotionPlan(plan: DomainPromotionPlan): string {
  const lines = [
    `Domain promotion plan for ${plan.project}`,
    `From: ${plan.from.activeDomain ?? plan.from.mode}`,
    `To: ${plan.to.activeDomain ?? plan.to.mode}`,
    "",
    "URL changes:"
  ];

  for (const change of plan.urlChanges) {
    lines.push(`- ${change.environment}.${String(change.key)}: ${change.from ?? "(none)"} -> ${change.to ?? "(none)"}`);
  }

  lines.push("", "Provider actions:");
  for (const action of plan.providerActions) {
    lines.push(`- ${action}`);
  }

  lines.push("", "Manual actions:");
  for (const action of plan.manualActions) {
    lines.push(`- ${action}`);
  }

  return lines.join("\n");
}
