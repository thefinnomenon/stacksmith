import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { defaultCommandRunner, type CommandRunner } from "./process.js";
import type { ProjectManifest, ProjectState, ProviderId } from "./types.js";
import { cloudRunReadinessChecks } from "../providers/cloud-run-readiness.js";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  message: string;
  remediation?: string;
}

export interface DoctorReport {
  project: string;
  status: DoctorStatus;
  checks: DoctorCheck[];
}

export type ExecutableChecker = (command: string, pathValue?: string) => Promise<boolean>;

const providerTools: Partial<Record<ProviderId, string[]>> = {
  github: ["git", "gh"],
  vercel: ["vercel"],
  "cloud-run": ["gcloud"],
  "prisma-postgres": ["npx"],
  cloudflare: ["wrangler", "cloudflared"],
  resend: [],
  stripe: ["stripe"],
  posthog: [],
  slack: []
};

const providerEnv: Partial<Record<ProviderId, string[]>> = {
  vercel: ["VERCEL_TOKEN"],
  "prisma-postgres": ["DATABASE_URL"],
  cloudflare: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  resend: ["RESEND_API_KEY"],
  stripe: ["STRIPE_SECRET_KEY"],
  posthog: ["POSTHOG_PROJECT_API_KEY", "POSTHOG_HOST"],
  slack: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"]
};

async function executableExists(command: string): Promise<boolean> {
  const path = process.env.PATH ?? "";
  const candidates = path.split(delimiter).filter(Boolean).map((dir) => join(dir, command));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Try the next PATH entry.
    }
  }

  return false;
}

async function executableExistsWithPath(command: string, pathValue: string | undefined): Promise<boolean> {
  const path = pathValue ?? "";
  const candidates = path.split(delimiter).filter(Boolean).map((dir) => join(dir, command));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Try the next PATH entry.
    }
  }

  return false;
}

function statusRank(status: DoctorStatus): number {
  return status === "fail" ? 2 : status === "warn" ? 1 : 0;
}

function overallStatus(checks: DoctorCheck[]): DoctorStatus {
  return checks.reduce<DoctorStatus>((current, check) => (
    statusRank(check.status) > statusRank(current) ? check.status : current
  ), "pass");
}

function validateUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function enabledProviders(manifest: ProjectManifest): ProviderId[] {
  return Object.entries(manifest.providers)
    .filter(([, config]) => config.enabled)
    .map(([id]) => id as ProviderId);
}

export async function runDoctor(input: {
  manifest: ProjectManifest;
  state: ProjectState;
  env?: NodeJS.ProcessEnv;
  runCommand?: CommandRunner;
  executableExists?: ExecutableChecker;
}): Promise<DoctorReport> {
  const env = input.env ?? process.env;
  const runCommand = input.runCommand ?? defaultCommandRunner;
  const toolExists = input.executableExists ?? ((command, pathValue) => (
    input.env ? executableExistsWithPath(command, pathValue) : executableExists(command)
  ));
  const checks: DoctorCheck[] = [];

  checks.push({
    id: "manifest.schema",
    label: "Manifest schema",
    status: input.manifest.schemaVersion === 1 ? "pass" : "fail",
    message: `schemaVersion=${input.manifest.schemaVersion}`,
    remediation: "Regenerate or migrate the Stacksmith manifest."
  });

  for (const [environment, config] of Object.entries(input.manifest.environments)) {
    checks.push({
      id: `manifest.environment.${environment}`,
      label: `${environment} URLs`,
      status: validateUrl(config.appUrl) ? "pass" : "fail",
      message: validateUrl(config.appUrl)
        ? `APP_URL is ${config.appUrl}`
        : "APP_URL is missing or invalid.",
      remediation: `Set environments.${environment}.appUrl to an absolute URL.`
    });
  }

  checks.push({
    id: "state.project",
    label: "State project",
    status: input.state.projectSlug === input.manifest.slug ? "pass" : "fail",
    message: `state.projectSlug=${input.state.projectSlug}`,
    remediation: "Recreate state with `stacksmith create` or inspect the wrong state path."
  });

  for (const provider of enabledProviders(input.manifest)) {
    const tools = providerTools[provider] ?? [];
    for (const tool of tools) {
      const present = await toolExists(tool, env.PATH);
      checks.push({
        id: `tool.${tool}`,
        label: `${tool} CLI`,
        status: present ? "pass" : "warn",
        message: present ? `${tool} found on PATH.` : `${tool} not found on PATH.`,
        remediation: `Install or authenticate ${tool} before enabling real ${provider} provisioning.`
      });
    }

    const variables = providerEnv[provider] ?? [];
    for (const variable of variables) {
      const present = Boolean(env[variable]);
      checks.push({
        id: `env.${provider}.${variable}`,
        label: `${provider} credential ${variable}`,
        status: present ? "pass" : "warn",
        message: present ? `${variable} is set.` : `${variable} is not set.`,
        remediation: `Set ${variable} in your shell or future Stacksmith control-plane secret store.`
      });
    }

    if (provider === "cloud-run") {
      const gcloudPresent = await toolExists("gcloud", env.PATH);
      if (gcloudPresent) {
        checks.push(...await cloudRunReadinessChecks({
          manifest: input.manifest,
          run: runCommand,
          env
        }));
      } else {
        checks.push({
          id: "cloud-run.readiness",
          label: "Cloud Run readiness",
          status: "warn",
          message: "Skipped Cloud Run readiness checks because gcloud is not installed.",
          remediation: "Install the Google Cloud CLI, authenticate, and rerun `stacksmith doctor`."
        });
      }
    }

    if (provider === "github") {
      const ghPresent = await toolExists("gh", env.PATH);
      if (ghPresent) {
        const auth = await runCommand("gh", ["auth", "status"], env);
        checks.push({
          id: "github.auth",
          label: "GitHub authentication",
          status: auth.exitCode === 0 ? "pass" : "warn",
          message: auth.exitCode === 0 ? "GitHub CLI is authenticated." : "GitHub CLI is not authenticated.",
          remediation: "Run `gh auth login` or configure GitHub CLI authentication before executing GitHub commands."
        });
      } else {
        checks.push({
          id: "github.auth",
          label: "GitHub authentication",
          status: "warn",
          message: "Skipped GitHub authentication check because gh is not installed.",
          remediation: "Install GitHub CLI and run `gh auth login`."
        });
      }
    }
  }

  return {
    project: input.manifest.slug,
    status: overallStatus(checks),
    checks
  };
}
