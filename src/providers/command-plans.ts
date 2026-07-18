import type { ExternalCommand } from "../core/commands.js";
import type { ProjectManifest, ProviderId } from "../core/types.js";
import { cloudflareCommandPlan } from "./cloudflare-plan.js";
import { cloudRunProjectId, cloudRunRegion } from "./cloud-run-project.js";

export function providerCommandPlan(provider: ProviderId, manifest: ProjectManifest): ExternalCommand[] {
  switch (provider) {
    case "github":
      return githubCommandPlan(manifest);

    case "vercel":
      return vercelCommandPlan(manifest);

    case "cloud-run":
      return cloudRunCommandPlan(manifest);

    case "cloudflare":
      return cloudflareCommandPlan(manifest);

    case "stripe":
      return stripeCommandPlan(manifest);

    default:
      return [];
  }
}

function githubCommandPlan(manifest: ProjectManifest): ExternalCommand[] {
  const provider = "github" as const;
  const repo = `${manifest.providers.github.owner ?? "OWNER"}/${manifest.slug}`;

  return [
    {
      provider,
      id: "github.repo.create",
      description: "Create the GitHub repository.",
      command: "gh",
      args: [
        "repo",
        "create",
        repo,
        manifest.providers.github.private === false ? "--public" : "--private",
        "--source",
        ".",
        "--remote",
        "origin"
      ],
      risk: "reversible",
      requiresConfirmation: true,
      env: ["GITHUB_TOKEN"],
      check: {
        description: "GitHub repository exists.",
        command: "gh",
        args: ["repo", "view", repo],
        env: ["GITHUB_TOKEN"]
      },
      undo: {
        description: "Delete the GitHub repository.",
        command: "gh",
        args: ["repo", "delete", repo, "--yes"],
        risk: "destructive",
        requiresConfirmation: true,
        env: ["GITHUB_TOKEN"]
      }
    },
    {
      provider,
      id: "github.repo.push",
      description: "Push the current branch to GitHub.",
      command: "git",
      args: ["push", "-u", "origin", "HEAD"],
      risk: "reversible",
      requiresConfirmation: true,
      check: {
        description: "Git remote origin is configured.",
        command: "git",
        args: ["remote", "get-url", "origin"]
      },
      undo: {
        description: "Remove the local origin remote.",
        command: "git",
        args: ["remote", "remove", "origin"],
        risk: "reversible",
        requiresConfirmation: true
      }
    }
  ];
}

function vercelCommandPlan(manifest: ProjectManifest): ExternalCommand[] {
  const provider = "vercel" as const;

  return [
    {
      provider,
      id: "vercel.project.link",
      description: "Link or create the Vercel project.",
      command: "vercel",
      args: ["link", "--project", manifest.slug, "--yes"],
      risk: "reversible",
      requiresConfirmation: true,
      env: ["VERCEL_TOKEN"],
      check: {
        description: "Local Vercel project link exists.",
        command: "test",
        args: ["-f", ".vercel/project.json"]
      },
      undo: {
        description: "Remove the local Vercel project link.",
        command: "rm",
        args: ["-rf", ".vercel"],
        risk: "reversible",
        requiresConfirmation: true
      }
    },
    ...vercelEnvCommands(manifest)
  ];
}

function stripeCommandPlan(manifest: ProjectManifest): ExternalCommand[] {
  const provider = "stripe" as const;
  const webhookUrl = manifest.environments.preview.stripeWebhookUrl ?? "https://stripe-preview.example.com/webhooks";

  return [
    {
      provider,
      id: "stripe.webhook.preview-router",
      description: "Create a Stripe test-mode webhook for the preview router.",
      command: "stripe",
      args: ["webhook_endpoints", "create", "--url", webhookUrl],
      risk: "reversible",
      requiresConfirmation: true,
      env: ["STRIPE_SECRET_KEY"],
      check: {
        description: "Stripe preview webhook endpoint is listed.",
        command: "stripe",
        args: ["webhook_endpoints", "list", "--limit", "100"],
        stdoutIncludes: webhookUrl,
        env: ["STRIPE_SECRET_KEY"]
      },
      undo: {
        description: "Delete a Stripe webhook endpoint by id.",
        command: "stripe",
        args: ["webhook_endpoints", "delete", "$STRIPE_PREVIEW_WEBHOOK_ENDPOINT_ID"],
        risk: "destructive",
        requiresConfirmation: true,
        env: ["STRIPE_SECRET_KEY", "STRIPE_PREVIEW_WEBHOOK_ENDPOINT_ID"]
      }
    }
  ];
}

function cloudRunCommandPlan(manifest: ProjectManifest): ExternalCommand[] {
  const provider = "cloud-run" as const;
  const projectId = cloudRunProjectId(manifest);
  const region = cloudRunRegion(manifest);
  const repository = `${manifest.slug}-images`;
  const apiService = `${manifest.slug}-api`;
  const workerJob = `${manifest.slug}-worker`;

  return [
    {
      provider,
      id: "cloud-run.project.create",
      description: "Create the Google Cloud project Stacksmith will manage for this app.",
      command: "gcloud",
      args: ["projects", "create", projectId, "--name", manifest.name, "--set-as-default"],
      risk: "production-write",
      requiresConfirmation: true,
      check: {
        description: "Google Cloud project exists.",
        command: "gcloud",
        args: ["projects", "describe", projectId]
      },
      undo: {
        description: "Delete the Google Cloud project.",
        command: "gcloud",
        args: ["projects", "delete", projectId, "--quiet"],
        risk: "destructive",
        requiresConfirmation: true
      }
    },
    {
      provider,
      id: "cloud-run.billing.link",
      description: "Link the Google Cloud project to the selected billing account.",
      command: "gcloud",
      args: ["billing", "projects", "link", projectId, "--billing-account", "$GOOGLE_CLOUD_BILLING_ACCOUNT_ID"],
      risk: "production-write",
      requiresConfirmation: true,
      env: ["GOOGLE_CLOUD_BILLING_ACCOUNT_ID"],
      check: {
        description: "Google Cloud project billing is enabled.",
        command: "gcloud",
        args: ["billing", "projects", "describe", projectId, "--format=value(billingEnabled)"],
        stdoutIncludes: "True"
      },
      undo: {
        description: "Unlink billing from the Google Cloud project.",
        command: "gcloud",
        args: ["billing", "projects", "unlink", projectId],
        risk: "production-write",
        requiresConfirmation: true
      }
    },
    {
      provider,
      id: "cloud-run.services.enable",
      description: "Enable Cloud Run, Cloud Build, Artifact Registry, and Scheduler APIs.",
      command: "gcloud",
      args: [
        "services",
        "enable",
        "run.googleapis.com",
        "cloudbuild.googleapis.com",
        "artifactregistry.googleapis.com",
        "cloudscheduler.googleapis.com",
        "--project",
        projectId
      ],
      risk: "reversible",
      requiresConfirmation: true,
      check: {
        description: "Required Google APIs are enabled.",
        command: "gcloud",
        args: ["services", "list", "--enabled", "--project", projectId, "--format=value(config.name)"],
        stdoutIncludes: "run.googleapis.com"
      },
      undo: {
        description: "Disable Cloud Run related Google APIs.",
        command: "gcloud",
        args: [
          "services",
          "disable",
          "run.googleapis.com",
          "cloudbuild.googleapis.com",
          "artifactregistry.googleapis.com",
          "cloudscheduler.googleapis.com",
          "--project",
          projectId,
          "--quiet"
        ],
        risk: "destructive",
        requiresConfirmation: true
      }
    },
    {
      provider,
      id: "cloud-run.artifact-registry.create",
      description: "Create the Docker Artifact Registry repository for Cloud Run builds.",
      command: "gcloud",
      args: [
        "artifacts",
        "repositories",
        "create",
        repository,
        "--repository-format",
        "docker",
        "--location",
        region,
        "--description",
        `Stacksmith images for ${manifest.name}`,
        "--project",
        projectId
      ],
      risk: "production-write",
      requiresConfirmation: true,
      check: {
        description: "Artifact Registry repository exists.",
        command: "gcloud",
        args: ["artifacts", "repositories", "describe", repository, "--location", region, "--project", projectId]
      },
      undo: {
        description: "Delete the Artifact Registry repository.",
        command: "gcloud",
        args: ["artifacts", "repositories", "delete", repository, "--location", region, "--project", projectId, "--quiet"],
        risk: "destructive",
        requiresConfirmation: true
      }
    },
    {
      provider,
      id: "cloud-run.api.deploy",
      description: "Deploy the scale-to-zero API service to Cloud Run.",
      command: "gcloud",
      args: [
        "run",
        "deploy",
        apiService,
        "--source",
        ".",
        "--region",
        region,
        "--allow-unauthenticated",
        "--min-instances",
        "0",
        "--timeout",
        "3600",
        "--project",
        projectId
      ],
      risk: "reversible",
      requiresConfirmation: true,
      check: {
        description: "Cloud Run API service exists.",
        command: "gcloud",
        args: ["run", "services", "describe", apiService, "--region", region, "--project", projectId]
      },
      undo: {
        description: "Delete the Cloud Run API service.",
        command: "gcloud",
        args: ["run", "services", "delete", apiService, "--region", region, "--project", projectId, "--quiet"],
        risk: "destructive",
        requiresConfirmation: true
      }
    },
    {
      provider,
      id: "cloud-run.job.worker.deploy",
      description: "Deploy the background worker as a Cloud Run Job.",
      command: "gcloud",
      args: [
        "run",
        "jobs",
        "deploy",
        workerJob,
        "--source",
        ".",
        "--region",
        region,
        "--task-timeout",
        "3600",
        "--project",
        projectId
      ],
      risk: "reversible",
      requiresConfirmation: true,
      check: {
        description: "Cloud Run worker job exists.",
        command: "gcloud",
        args: ["run", "jobs", "describe", workerJob, "--region", region, "--project", projectId]
      },
      undo: {
        description: "Delete the Cloud Run worker job.",
        command: "gcloud",
        args: ["run", "jobs", "delete", workerJob, "--region", region, "--project", projectId, "--quiet"],
        risk: "destructive",
        requiresConfirmation: true
      }
    },
    {
      provider,
      id: "cloud-run.job.worker.execute",
      description: "Execute the background worker Cloud Run Job.",
      command: "gcloud",
      args: ["run", "jobs", "execute", workerJob, "--region", region, "--project", projectId],
      risk: "reversible",
      requiresConfirmation: true,
      undo: {
        description: "Cloud Run job executions are one-shot and cannot be undone.",
        command: "stacksmith",
        args: ["noop", "cloud-run.job.worker.execute"],
        risk: "read-only",
        requiresConfirmation: false
      }
    }
  ];
}

const vercelEnvMappings = [
  ["APP_URL", "production"],
  ["API_URL", "production"],
  ["FILES_URL", "production"],
  ["DATABASE_URL", "production"],
  ["DIRECT_DATABASE_URL", "production"],
  ["NEXT_PUBLIC_SENTRY_DSN", "production"],
  ["NEXT_PUBLIC_MIXPANEL_TOKEN", "production"]
] as const;

function vercelEnvCommands(manifest: ProjectManifest): ExternalCommand[] {
  return vercelEnvMappings.map(([name, environment]) => ({
    provider: "vercel" as const,
    id: `vercel.env.${environment}.${name}`,
    description: `Set ${name} for the Vercel ${environment} environment from local env.`,
    command: "vercel",
    args: ["env", "add", name, environment],
    risk: environment === "production" ? "production-write" as const : "reversible" as const,
    requiresConfirmation: true,
    env: ["VERCEL_TOKEN", name],
    stdinFromEnv: name,
    check: {
      description: `${name} exists in the Vercel ${environment} environment.`,
      command: "vercel",
      args: ["env", "ls", environment],
      stdoutIncludes: name,
      env: ["VERCEL_TOKEN"]
    },
    undo: {
      description: `Remove ${name} from the Vercel ${environment} environment.`,
      command: "vercel",
      args: ["env", "rm", name, environment, "--yes"],
      risk: environment === "production" ? "production-write" as const : "reversible" as const,
      requiresConfirmation: true,
      env: ["VERCEL_TOKEN"]
    }
  }));
}

export function allProviderCommandPlans(manifest: ProjectManifest): ExternalCommand[] {
  return (Object.keys(manifest.providers) as ProviderId[])
    .filter((provider) => manifest.providers[provider].enabled)
    .flatMap((provider) => providerCommandPlan(provider, manifest));
}
