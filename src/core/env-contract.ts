import type { EnvironmentName, ProjectManifest } from "./types.js";

export type EnvVisibility = "server" | "public";

export interface EnvContractVariable {
  name: string;
  visibility: EnvVisibility;
  requiredIn: EnvironmentName[];
  description: string;
  example(manifest: ProjectManifest, environment: EnvironmentName): string;
}

export const envContract: EnvContractVariable[] = [
  {
    name: "STACKSMITH_PROJECT",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Stable Stacksmith project slug.",
    example: (manifest) => manifest.slug
  },
  {
    name: "APP_ENV",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Deployment environment.",
    example: (_manifest, environment) => environment
  },
  {
    name: "APP_URL",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Canonical web application URL.",
    example: (manifest, environment) => manifest.environments[environment].appUrl
  },
  {
    name: "API_URL",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Canonical API URL.",
    example: (manifest, environment) => manifest.environments[environment].apiUrl ?? ""
  },
  {
    name: "FILES_URL",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Canonical public file URL.",
    example: (manifest, environment) => manifest.environments[environment].filesUrl ?? ""
  },
  {
    name: "AUTH_CALLBACK_URL",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Canonical auth callback URL for the current environment.",
    example: (manifest, environment) => manifest.environments[environment].authCallbackUrl ?? `${manifest.environments[environment].appUrl}/api/auth/callback`
  },
  {
    name: "EMAIL_LINK_BASE_URL",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Base URL used when generating email OTP and magic-link URLs.",
    example: (manifest, environment) => manifest.environments[environment].emailLinkBaseUrl ?? manifest.environments[environment].appUrl
  },
  {
    name: "STRIPE_WEBHOOK_URL",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Stripe webhook endpoint URL for this environment.",
    example: (manifest, environment) => manifest.environments[environment].stripeWebhookUrl ?? `${manifest.environments[environment].apiUrl}/webhooks/stripe`
  },
  {
    name: "PREVIEW_ID",
    visibility: "server",
    requiredIn: ["preview"],
    description: "Stable preview identifier such as pr-184.",
    example: () => ""
  },
  {
    name: "GITHUB_PR_NUMBER",
    visibility: "server",
    requiredIn: ["preview"],
    description: "Pull request number for preview deployments.",
    example: () => ""
  },
  {
    name: "GIT_BRANCH",
    visibility: "server",
    requiredIn: ["preview", "staging", "production"],
    description: "Git branch for the deployment.",
    example: () => ""
  },
  {
    name: "GIT_SHA",
    visibility: "server",
    requiredIn: ["preview", "staging", "production"],
    description: "Git commit SHA for release and error correlation.",
    example: () => ""
  },
  {
    name: "DATABASE_URL",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Pooled application database URL.",
    example: (manifest) => `postgresql://user:password@localhost:5432/${manifest.slug}`
  },
  {
    name: "DIRECT_DATABASE_URL",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Direct database URL for migrations and administrative operations.",
    example: (manifest) => `postgresql://user:password@localhost:5432/${manifest.slug}`
  },
  {
    name: "R2_BUCKET_NAME",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Cloudflare R2 bucket name.",
    example: (manifest, environment) => {
      const suffix = environment === "production"
        ? "production"
        : environment === "development"
          ? "dev"
          : "staging";
      return `${manifest.slug}-${suffix}`;
    }
  },
  {
    name: "R2_PREFIX",
    visibility: "server",
    requiredIn: ["preview"],
    description: "Preview-specific object key prefix.",
    example: () => ""
  },
  {
    name: "R2_ACCOUNT_ID",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Cloudflare account id.",
    example: () => ""
  },
  {
    name: "R2_ACCESS_KEY_ID",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "R2 S3-compatible access key id.",
    example: () => ""
  },
  {
    name: "R2_SECRET_ACCESS_KEY",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "R2 S3-compatible secret access key.",
    example: () => ""
  },
  {
    name: "R2_ENDPOINT",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "R2 S3-compatible endpoint.",
    example: () => ""
  },
  {
    name: "R2_EVENT_WEBHOOK_SECRET",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Shared secret used to verify Cloudflare R2 event forwarder webhooks.",
    example: () => ""
  },
  {
    name: "RESEND_API_KEY",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Resend API key for transactional email.",
    example: () => ""
  },
  {
    name: "EMAIL_FROM",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Default sender address.",
    example: (manifest) => manifest.domain ? `hello@${manifest.domain}` : `hello@${manifest.slug}.vercel.app`
  },
  {
    name: "POSTHOG_PROJECT_API_KEY",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Server-side PostHog project API key.",
    example: () => ""
  },
  {
    name: "NEXT_PUBLIC_POSTHOG_KEY",
    visibility: "public",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Browser PostHog project API key.",
    example: () => ""
  },
  {
    name: "POSTHOG_HOST",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "PostHog API host.",
    example: () => "https://us.i.posthog.com"
  },
  {
    name: "NEXT_PUBLIC_POSTHOG_HOST",
    visibility: "public",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Browser PostHog host.",
    example: () => "https://us.i.posthog.com"
  },
  {
    name: "POSTHOG_PROJECT_SLUG",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Project discriminator for shared incubator PostHog projects.",
    example: (manifest) => manifest.slug
  },
  {
    name: "NEXT_PUBLIC_POSTHOG_PROJECT_SLUG",
    visibility: "public",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Browser project discriminator for shared incubator PostHog projects.",
    example: (manifest) => manifest.slug
  },
  {
    name: "POSTHOG_ALLOCATION",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "PostHog project allocation policy.",
    example: (manifest) => manifest.providers.posthog.allocation ?? "shared-incubator"
  },
  {
    name: "POSTHOG_SHARED_PROJECT_NAME",
    visibility: "server",
    requiredIn: ["development", "preview", "staging", "production"],
    description: "Shared PostHog incubator project name used until project promotion.",
    example: (manifest) => manifest.providers.posthog.sharedProjectName ?? "stacksmith-incubator"
  },
  {
    name: "SLACK_ALERTS_CHANNEL_ID",
    visibility: "server",
    requiredIn: ["staging", "production"],
    description: "Slack alerts channel id.",
    example: () => ""
  }
];

export function envExample(manifest: ProjectManifest, environment: EnvironmentName = "development"): string {
  return envContract
    .map((variable) => `${variable.name}=${variable.example(manifest, environment)}`)
    .join("\n") + "\n";
}

export function requiredEnvNames(environment: EnvironmentName): string[] {
  return envContract
    .filter((variable) => variable.requiredIn.includes(environment))
    .map((variable) => variable.name);
}
