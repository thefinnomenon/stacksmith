import { spawn } from "node:child_process";
import {
  defaultStacksmithEnvFile,
  inferCloudflareAccountId,
  readEnvFileValue
} from "./cloudflare-r2-credentials.js";

const cloudflareApiBase = "https://api.cloudflare.com/client/v4";
const workersSetupUrl = "https://dash.cloudflare.com/?to=/:account/workers-and-pages";

export interface CloudflareWorkersSubdomainStatus {
  status: "ready" | "missing" | "unknown";
  accountId?: string;
  subdomain?: string;
  setupUrl: string;
  message: string;
}

export interface CloudflareWorkersSetupOptions {
  accountId?: string;
  apiToken?: string;
  open?: boolean;
  execute?: boolean;
  fetchImpl?: typeof fetch;
  opener?: (url: string) => Promise<void>;
}

export interface CloudflareWorkersSetupResult extends CloudflareWorkersSubdomainStatus {
  opened: boolean;
}

export function cloudflareWorkersSetupUrl(): string {
  return workersSetupUrl;
}

export async function checkCloudflareWorkersSubdomain(options: CloudflareWorkersSetupOptions = {}): Promise<CloudflareWorkersSubdomainStatus> {
  const accountId = await inferCloudflareAccountId({ accountId: options.accountId }).catch(() => undefined);
  const apiToken = options.apiToken
    ?? process.env.CLOUDFLARE_API_TOKEN
    ?? await readEnvFileValue(defaultStacksmithEnvFile(), "CLOUDFLARE_API_TOKEN");

  if (!accountId || !apiToken) {
    return {
      status: "unknown",
      accountId,
      setupUrl: workersSetupUrl,
      message: "Unable to verify Cloudflare Workers subdomain without CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN."
    };
  }

  const response = await (options.fetchImpl ?? fetch)(`${cloudflareApiBase}/accounts/${accountId}/workers/subdomain`, {
    headers: {
      "authorization": `Bearer ${apiToken}`,
      "content-type": "application/json"
    }
  });
  const json = await response.json().catch(() => undefined) as {
    success?: boolean;
    result?: { subdomain?: string };
    errors?: Array<{ code?: number; message?: string }>;
  } | undefined;

  if (response.ok && json?.success && json.result?.subdomain) {
    return {
      status: "ready",
      accountId,
      subdomain: json.result.subdomain,
      setupUrl: workersSetupUrl,
      message: `Cloudflare Workers subdomain is initialized: ${json.result.subdomain}.workers.dev.`
    };
  }

  const details = json?.errors?.map((error) => `${error.code ?? "unknown"} ${error.message ?? ""}`.trim()).filter(Boolean).join("; ");
  if (details?.includes("workers.dev subdomain") || details?.includes("10007")) {
    return {
      status: "missing",
      accountId,
      setupUrl: workersSetupUrl,
      message: `Cloudflare Workers subdomain is not initialized. Open ${workersSetupUrl}. ${details}`
    };
  }

  return {
    status: "unknown",
    accountId,
    setupUrl: workersSetupUrl,
    message: `Unable to verify Cloudflare Workers subdomain.${details ? ` Cloudflare response: ${details}` : ""}`
  };
}

export async function setupCloudflareWorkers(options: CloudflareWorkersSetupOptions = {}): Promise<CloudflareWorkersSetupResult> {
  let opened = false;
  if (options.open) {
    await (options.opener ?? openUrl)(workersSetupUrl);
    opened = true;
  }

  if (!options.execute) {
    return {
      status: "unknown",
      setupUrl: workersSetupUrl,
      opened,
      message: "Dry run only. Re-run with --execute to verify the Cloudflare Workers subdomain."
    };
  }

  const status = await checkCloudflareWorkersSubdomain(options);
  return { ...status, opened };
}

async function openUrl(url: string): Promise<void> {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  const result = await new Promise<{ exitCode: number | null; stderr: string }>((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => resolve({ exitCode: null, stderr: error.message }));
    child.on("close", (exitCode) => resolve({ exitCode, stderr: Buffer.concat(stderr).toString("utf8") }));
  });

  if (result.exitCode !== 0) {
    throw new Error(`Unable to open ${url}.\n${result.stderr}`);
  }
}
