import type { ProjectManifest } from "./types.js";

export interface DevSessionPlan {
  project: string;
  mode: "quick-tunnel" | "named-tunnel";
  processes: Array<{
    id: string;
    command: string;
    url: string;
  }>;
  envUpdates: Record<string, string>;
  notes: string[];
}

export function planDevSession(manifest: ProjectManifest): DevSessionPlan {
  const named = manifest.domainMode === "managed" || manifest.domainMode === "subdomain";
  const appUrl = manifest.environments.development.appUrl;
  const apiUrl = manifest.environments.development.apiUrl ?? "http://localhost:4000";

  return {
    project: manifest.slug,
    mode: named ? "named-tunnel" : "quick-tunnel",
    processes: [
      {
        id: "web",
        command: "npm run dev",
        url: "http://localhost:3000"
      },
      {
        id: "api",
        command: "npm run dev:api",
        url: "http://localhost:4000"
      },
      named
        ? {
            id: "tunnel",
            command: `cloudflared tunnel run ${manifest.slug}-development`,
            url: appUrl
          }
        : {
            id: "tunnel-web",
            command: "cloudflared tunnel --url http://localhost:3000",
            url: "generated trycloudflare.com URL"
          }
    ],
    envUpdates: {
      APP_ENV: "development",
      APP_URL: appUrl,
      API_URL: apiUrl,
      FILES_URL: manifest.environments.development.filesUrl ?? "",
      AUTH_CALLBACK_URL: manifest.environments.development.authCallbackUrl ?? `${appUrl}/api/auth/callback`,
      EMAIL_LINK_BASE_URL: manifest.environments.development.emailLinkBaseUrl ?? appUrl,
      STRIPE_WEBHOOK_URL: manifest.environments.development.stripeWebhookUrl ?? `${apiUrl}/webhooks/stripe`
    },
    notes: named
      ? [
          "Named tunnel mode gives stable phone URLs and stable social OAuth callbacks.",
          "Run Cloudflare tunnel provisioning before relying on dev subdomains."
        ]
      : [
          "Quick tunnel mode gives HTTPS phone testing, but URLs are ephemeral.",
          "Social OAuth in local dev needs managed/subdomain mode or callback automation."
        ]
  };
}

export function formatDevSessionPlan(plan: DevSessionPlan): string {
  const lines = [
    `Dev session plan for ${plan.project}`,
    `Mode: ${plan.mode}`,
    "",
    "Processes:"
  ];

  for (const process of plan.processes) {
    lines.push(`- ${process.id}: ${process.command} (${process.url})`);
  }

  lines.push("", "Environment:");
  for (const [key, value] of Object.entries(plan.envUpdates)) {
    lines.push(`- ${key}=${value}`);
  }

  lines.push("", "Notes:");
  for (const note of plan.notes) {
    lines.push(`- ${note}`);
  }

  return lines.join("\n");
}
