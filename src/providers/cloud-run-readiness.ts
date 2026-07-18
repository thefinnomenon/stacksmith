import type { DoctorCheck } from "../core/doctor.js";
import type { CommandRunner } from "../core/process.js";
import type { ProjectManifest } from "../core/types.js";
import { cloudRunProjectId, cloudRunRegion } from "./cloud-run-project.js";

const requiredApis = [
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "cloudscheduler.googleapis.com"
];

function trim(value: string): string {
  return value.trim();
}

function check(id: string, label: string, status: DoctorCheck["status"], message: string, remediation?: string): DoctorCheck {
  return { id, label, status, message, remediation };
}

function enabledServices(output: string): Set<string> {
  return new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

export async function cloudRunReadinessChecks(input: {
  manifest: ProjectManifest;
  run: CommandRunner;
  env?: NodeJS.ProcessEnv;
}): Promise<DoctorCheck[]> {
  const env = input.env ?? process.env;
  const checks: DoctorCheck[] = [];
  const manifestProject = cloudRunProjectId(input.manifest);
  const projectFromEnv = env.GOOGLE_CLOUD_PROJECT?.trim();
  const configuredProject = await input.run("gcloud", ["config", "get-value", "project", "--quiet"], env);
  const projectFromGcloud = trim(configuredProject.stdout);
  const project = manifestProject || projectFromEnv || projectFromGcloud;

  checks.push(check(
    "cloud-run.project",
    "Google Cloud project",
    project ? "pass" : "warn",
    project ? `Project is ${project}.` : "No Google Cloud project is configured.",
    "Set providers.cloud-run.projectId in .stacksmith/project.json, or let Stacksmith generate one."
  ));

  const account = await input.run("gcloud", ["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"], env);
  const activeAccount = trim(account.stdout);
  checks.push(check(
    "cloud-run.auth",
    "gcloud active account",
    activeAccount ? "pass" : "warn",
    activeAccount ? `Active account is ${activeAccount}.` : "No active gcloud account found.",
    "Run `gcloud auth login` and `gcloud auth application-default login` if needed."
  ));

  if (!project) {
    return checks;
  }

  const billing = await input.run("gcloud", ["billing", "projects", "describe", project, "--format=value(billingEnabled)"], env);
  const billingValue = trim(billing.stdout).toLowerCase();
  const billingAccount = env.GOOGLE_CLOUD_BILLING_ACCOUNT_ID?.trim();
  checks.push(check(
    "cloud-run.billing-account",
    "Google Cloud billing account",
    billingAccount ? "pass" : "warn",
    billingAccount ? "GOOGLE_CLOUD_BILLING_ACCOUNT_ID is set." : "GOOGLE_CLOUD_BILLING_ACCOUNT_ID is not set.",
    "Run `gcloud billing accounts list` and set GOOGLE_CLOUD_BILLING_ACCOUNT_ID before running the billing link command."
  ));
  checks.push(check(
    "cloud-run.billing",
    "Google Cloud billing",
    billingValue === "true" ? "pass" : "warn",
    billingValue === "true" ? "Billing is enabled." : "Billing is not confirmed as enabled.",
    "Enable billing for the Google Cloud project before Cloud Run deployments."
  ));

  const services = await input.run("gcloud", ["services", "list", "--enabled", "--format=value(config.name)", "--project", project], env);
  const enabled = enabledServices(services.stdout);

  for (const api of requiredApis) {
    checks.push(check(
      `cloud-run.api.${api}`,
      `Google API ${api}`,
      enabled.has(api) ? "pass" : "warn",
      enabled.has(api) ? `${api} is enabled.` : `${api} is not enabled.`,
      `Run \`gcloud services enable ${api} --project ${project}\`.`
    ));
  }

  const region = cloudRunRegion(input.manifest);
  checks.push(check(
    "cloud-run.region",
    "Cloud Run region",
    "pass",
    `Region is ${region}.`
  ));

  const artifactRepos = await input.run("gcloud", ["artifacts", "repositories", "list", "--location", region, "--format=value(name)", "--project", project], env);
  checks.push(check(
    "cloud-run.artifact-registry",
    "Artifact Registry",
    trim(artifactRepos.stdout) ? "pass" : "warn",
    trim(artifactRepos.stdout) ? "Artifact Registry repositories are visible." : "No Artifact Registry repositories found in the configured region.",
    `Create a Docker repository in ${region} or allow Cloud Run source deploys to create required build artifacts.`
  ));

  return checks;
}

export { requiredApis as cloudRunRequiredApis };
