import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { EnvironmentName, ProjectManifest } from "../core/types.js";

const cloudflareApiBase = "https://api.cloudflare.com/client/v4";
const r2ObjectReadWritePermissionName = "Workers R2 Storage Bucket Item Write";
const defaultStacksmithEnvPath = join(homedir(), ".stacksmith", "env.local");

export interface CloudflareR2CredentialOptions {
  manifest: ProjectManifest;
  environment: EnvironmentName;
  bucketName?: string;
  accountId?: string;
  tokenName?: string;
  envFile?: string;
  filesUrl?: string;
  prefix?: string;
  apiToken?: string;
  execute?: boolean;
  fetchImpl?: typeof fetch;
  wranglerWhoamiOutput?: string;
}

export interface CloudflareR2DeleteTokenOptions {
  tokenId: string;
  accountId?: string;
  apiToken?: string;
  execute?: boolean;
  fetchImpl?: typeof fetch;
}

export interface CloudflareTokenSetupOptions {
  apiToken?: string;
  accountId?: string;
  envFile?: string;
  save?: boolean;
  open?: boolean;
  execute?: boolean;
  fetchImpl?: typeof fetch;
  opener?: (url: string) => Promise<void>;
}

export interface CloudflareTokenSetupResult {
  status: "instructions" | "validated" | "saved";
  tokenPageUrl: string;
  envFile: string;
  opened: boolean;
  validated: boolean;
  saved: boolean;
  requiredPermissions: string[];
  message: string;
}

export interface CloudflareR2EnvValues {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_ENDPOINT: string;
  FILES_URL: string;
  R2_PREFIX: string;
}

export interface CloudflareR2CredentialResult {
  status: "planned" | "configured";
  tokenId?: string;
  tokenName: string;
  envFile: string;
  environment: EnvironmentName;
  bucketName: string;
  accountId: string;
  endpoint: string;
  filesUrl: string;
  prefix: string;
  envKeys: Array<keyof CloudflareR2EnvValues>;
  message: string;
}

interface CloudflareApiResponse<T> {
  success: boolean;
  result?: T;
  errors?: Array<{ message?: string }>;
  messages?: Array<{ message?: string }>;
}

interface CloudflarePermissionGroup {
  id: string;
  name?: string;
}

interface CloudflareTokenResult {
  id?: string;
  value?: string;
  name?: string;
}

interface CloudflareTokenApiTarget {
  owner: "account" | "user";
  accountId?: string;
  basePath: string;
}

interface CloudflareR2PermissionGroupResult {
  permissionGroup: CloudflarePermissionGroup;
  target: CloudflareTokenApiTarget;
}

export function deriveR2SecretAccessKey(tokenValue: string): string {
  return createHash("sha256").update(tokenValue).digest("hex");
}

export function r2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function r2BucketNameForEnvironment(manifest: ProjectManifest, environment: EnvironmentName): string {
  if (environment === "production") {
    return `${manifest.slug}-production`;
  }

  if (environment === "development") {
    return `${manifest.slug}-dev`;
  }

  return `${manifest.slug}-staging`;
}

export function r2PrefixForEnvironment(environment: EnvironmentName, previewId?: string): string {
  if (environment !== "preview") {
    return "";
  }

  return `previews/${previewId ?? "local"}/`;
}

export function parseWranglerAccountId(output: string): string | undefined {
  const tableMatch = output.match(/Account ID\s*│\s*\n[^\n]*\n│[^│]*│\s*([a-f0-9]{32})\s*│/i);
  if (tableMatch?.[1]) {
    return tableMatch[1];
  }

  const looseMatch = output.match(/\b([a-f0-9]{32})\b/i);
  return looseMatch?.[1];
}

export function buildR2BucketResource(accountId: string, bucketName: string, jurisdiction = "default"): string {
  return `com.cloudflare.edge.r2.bucket.${accountId}_${jurisdiction}_${bucketName}`;
}

export function buildR2TokenCreateBody(input: {
  tokenName: string;
  accountId: string;
  bucketName: string;
  permissionGroupId: string;
}) {
  return {
    name: input.tokenName,
    policies: [
      {
        effect: "allow",
        permission_groups: [
          {
            id: input.permissionGroupId,
            meta: {}
          }
        ],
        resources: {
          [buildR2BucketResource(input.accountId, input.bucketName)]: "*"
        }
      }
    ]
  };
}

export function r2EnvValues(input: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint?: string;
  filesUrl?: string;
  prefix?: string;
}): CloudflareR2EnvValues {
  return {
    R2_ACCOUNT_ID: input.accountId,
    R2_ACCESS_KEY_ID: input.accessKeyId,
    R2_SECRET_ACCESS_KEY: input.secretAccessKey,
    R2_BUCKET_NAME: input.bucketName,
    R2_ENDPOINT: input.endpoint ?? r2Endpoint(input.accountId),
    FILES_URL: input.filesUrl ?? "",
    R2_PREFIX: input.prefix ?? ""
  };
}

export function updateEnvContent(content: string, values: Record<string, string>, header = "Stacksmith R2"): string {
  const lines = content.length ? content.split(/\r?\n/) : [];
  const keyPattern = /^([A-Z0-9_]+)=/;
  const pending = new Map(Object.entries(values));
  const nextLines = lines.map((line) => {
    const key = line.match(keyPattern)?.[1];
    if (!key || !pending.has(key)) {
      return line;
    }

    const value = pending.get(key) ?? "";
    pending.delete(key);
    return `${key}=${formatEnvValue(value)}`;
  });

  if (pending.size > 0) {
    if (nextLines.length > 0 && nextLines.at(-1) !== "") {
      nextLines.push("");
    }

    nextLines.push(`# ${header}`);
    for (const [key, value] of pending) {
      nextLines.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  while (nextLines.length > 1 && nextLines.at(-1) === "" && nextLines.at(-2) === "") {
    nextLines.pop();
  }

  return `${nextLines.join("\n").replace(/\n*$/, "")}\n`;
}

export function cloudflareTokenSetupUrl(): string {
  return "https://dash.cloudflare.com/profile/api-tokens";
}

export function defaultStacksmithEnvFile(): string {
  return defaultStacksmithEnvPath;
}

export function cloudflareTokenSetupInstructions(): string[] {
  return [
    "Create an account API token with Account API Tokens Read and Edit/Write, or use Cloudflare's Create Additional Tokens template.",
    "The token must be allowed to call the account token API, not only the user token API.",
    "Copy the token once. Cloudflare will not show it again.",
    "Run `pbpaste | stacksmith cloudflare setup-token --token-stdin --save --execute` to validate and store it in ~/.stacksmith/env.local without putting the token in shell history."
  ];
}

export async function inferCloudflareAccountId(input: {
  accountId?: string;
  wranglerWhoamiOutput?: string;
} = {}): Promise<string> {
  if (input.accountId) {
    return input.accountId;
  }

  if (process.env.CLOUDFLARE_ACCOUNT_ID) {
    return process.env.CLOUDFLARE_ACCOUNT_ID;
  }

  if (input.wranglerWhoamiOutput) {
    const parsed = parseWranglerAccountId(input.wranglerWhoamiOutput);
    if (parsed) {
      return parsed;
    }
  }

  const result = await runCommand("wrangler", ["whoami"]);
  if (result.exitCode !== 0) {
    throw new Error(`Unable to infer Cloudflare account ID. Set CLOUDFLARE_ACCOUNT_ID or run \`wrangler login\`.\n${result.stderr}`);
  }

  const parsed = parseWranglerAccountId(result.stdout);
  if (!parsed) {
    throw new Error("Unable to parse a Cloudflare account ID from `wrangler whoami`. Set CLOUDFLARE_ACCOUNT_ID.");
  }

  return parsed;
}

export async function createR2Credentials(options: CloudflareR2CredentialOptions): Promise<CloudflareR2CredentialResult> {
  const envFile = options.envFile ?? ".env.local";
  const accountId = await inferCloudflareAccountId({
    accountId: options.accountId,
    wranglerWhoamiOutput: options.wranglerWhoamiOutput
  });
  const bucketName = options.bucketName ?? r2BucketNameForEnvironment(options.manifest, options.environment);
  const tokenName = options.tokenName ?? `stacksmith-${options.manifest.slug}-${options.environment}-r2-${randomUUID().slice(0, 8)}`;
  const prefix = options.prefix ?? r2PrefixForEnvironment(options.environment);
  const filesUrl = options.filesUrl ?? options.manifest.environments[options.environment].filesUrl ?? "";
  const endpoint = r2Endpoint(accountId);
  const envKeys = Object.keys(r2EnvValues({
    accountId,
    accessKeyId: "",
    secretAccessKey: "",
    bucketName,
    endpoint,
    filesUrl,
    prefix
  })) as Array<keyof CloudflareR2EnvValues>;

  if (!options.execute) {
    return {
      status: "planned",
      tokenName,
      envFile,
      environment: options.environment,
      bucketName,
      accountId,
      endpoint,
      filesUrl,
      prefix,
      envKeys,
      message: `Dry run only. Re-run with --execute to create a scoped R2 API token and update ${envFile}.`
    };
  }

  const apiToken = options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN ?? await readEnvFileValue(defaultStacksmithEnvFile(), "CLOUDFLARE_API_TOKEN");
  if (!apiToken) {
    throw new Error("Set CLOUDFLARE_API_TOKEN with API Tokens Write before creating R2 S3 credentials.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const permissionGroup = await findR2ObjectReadWritePermissionGroup({ apiToken, fetchImpl, accountId });
  const token = await createCloudflareApiToken({
    apiToken,
    fetchImpl,
    target: permissionGroup.target,
    body: buildR2TokenCreateBody({
      tokenName,
      accountId,
      bucketName,
      permissionGroupId: permissionGroup.permissionGroup.id
    })
  });

  if (!token.id || !token.value) {
    throw new Error("Cloudflare token creation did not return both token id and token value.");
  }

  const values = r2EnvValues({
    accountId,
    accessKeyId: token.id,
    secretAccessKey: deriveR2SecretAccessKey(token.value),
    bucketName,
    endpoint,
    filesUrl,
    prefix
  });

  await writeEnvFile(envFile, values);

  return {
    status: "configured",
    tokenId: token.id,
    tokenName,
    envFile,
    environment: options.environment,
    bucketName,
    accountId,
    endpoint,
    filesUrl,
    prefix,
    envKeys,
    message: `Created scoped R2 credentials and updated ${envFile}. Secret values were not printed.`
  };
}

export async function setupCloudflareApiToken(options: CloudflareTokenSetupOptions = {}): Promise<CloudflareTokenSetupResult> {
  const envFile = options.envFile ?? defaultStacksmithEnvFile();
  const tokenPageUrl = cloudflareTokenSetupUrl();
  let opened = false;

  if (options.open) {
    await (options.opener ?? openUrl)(tokenPageUrl);
    opened = true;
  }

  if (!options.apiToken) {
    return {
      status: "instructions",
      tokenPageUrl,
      envFile,
      opened,
      validated: false,
      saved: false,
      requiredPermissions: cloudflareTokenSetupInstructions(),
      message: "Create a Cloudflare API token, then re-run this command with --token <token>."
    };
  }

  if (!options.execute) {
    return {
      status: "instructions",
      tokenPageUrl,
      envFile,
      opened,
      validated: false,
      saved: false,
      requiredPermissions: cloudflareTokenSetupInstructions(),
      message: "Dry run only. Re-run with --execute to validate the token."
    };
  }

  const accountId = await inferCloudflareAccountId({ accountId: options.accountId });
  await validateCloudflareApiToken({
    apiToken: options.apiToken,
    accountId,
    fetchImpl: options.fetchImpl ?? fetch
  });

  if (!options.save) {
    return {
      status: "validated",
      tokenPageUrl,
      envFile,
      opened,
      validated: true,
      saved: false,
      requiredPermissions: cloudflareTokenSetupInstructions(),
      message: "Cloudflare API token validated. Re-run with --save --execute to write it to a local env file."
    };
  }

  await writeGenericEnvFile(envFile, {
    CLOUDFLARE_API_TOKEN: options.apiToken,
    CLOUDFLARE_ACCOUNT_ID: accountId
  }, "Stacksmith Cloudflare");

  return {
    status: "saved",
    tokenPageUrl,
    envFile,
    opened,
    validated: true,
    saved: true,
    requiredPermissions: cloudflareTokenSetupInstructions(),
    message: `Cloudflare API token validated and saved to ${envFile}.`
  };
}

export async function deleteCloudflareApiToken(options: CloudflareR2DeleteTokenOptions): Promise<{
  status: "planned" | "deleted";
  tokenId: string;
  message: string;
}> {
  if (!options.execute) {
    return {
      status: "planned",
      tokenId: options.tokenId,
      message: "Dry run only. Re-run with --execute to delete this Cloudflare API token."
    };
  }

  const apiToken = options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN ?? await readEnvFileValue(defaultStacksmithEnvFile(), "CLOUDFLARE_API_TOKEN");
  if (!apiToken) {
    throw new Error("Set CLOUDFLARE_API_TOKEN with API Tokens Write before deleting API tokens.");
  }
  const accountId = await inferCloudflareAccountId({ accountId: options.accountId });

  await cloudflareRequest<{ id?: string }>({
    path: `/accounts/${accountId}/tokens/${options.tokenId}`,
    method: "DELETE",
    apiToken,
    fetchImpl: options.fetchImpl ?? fetch
  });

  return {
    status: "deleted",
    tokenId: options.tokenId,
    message: `Deleted Cloudflare API token ${options.tokenId}.`
  };
}

async function validateCloudflareApiToken(input: {
  apiToken: string;
  accountId?: string;
  fetchImpl: typeof fetch;
}): Promise<void> {
  await cloudflareRequest<unknown>({
    path: "/user/tokens/verify",
    method: "GET",
    apiToken: input.apiToken,
    fetchImpl: input.fetchImpl
  });

  await findR2ObjectReadWritePermissionGroup(input);
}

async function writeEnvFile(path: string, values: CloudflareR2EnvValues): Promise<void> {
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch {
    current = "";
  }

  await writeFile(path, updateEnvContent(current, { ...values }), "utf8");
}

async function writeGenericEnvFile(path: string, values: Record<string, string>, header: string): Promise<void> {
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch {
    current = "";
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, updateEnvContent(current, values, header), "utf8");
}

async function readEnvFileValue(path: string, key: string): Promise<string | undefined> {
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch {
    return undefined;
  }

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] !== key) {
      continue;
    }

    const value = match[2] ?? "";
    if (value.startsWith("\"")) {
      try {
        return JSON.parse(value) as string;
      } catch {
        return value.slice(1, -1);
      }
    }

    return value;
  }

  return undefined;
}

async function findR2ObjectReadWritePermissionGroup(input: {
  apiToken: string;
  accountId?: string;
  fetchImpl: typeof fetch;
}): Promise<CloudflareR2PermissionGroupResult> {
  const targets: CloudflareTokenApiTarget[] = [
    ...(input.accountId ? [{
      owner: "account" as const,
      accountId: input.accountId,
      basePath: `/accounts/${input.accountId}/tokens`
    }] : []),
    {
      owner: "user" as const,
      basePath: "/user/tokens"
    }
  ];
  const errors: string[] = [];

  for (const target of targets) {
    try {
      const permissionGroups = await cloudflareRequest<CloudflarePermissionGroup[]>({
        path: `${target.basePath}/permission_groups`,
        method: "GET",
        apiToken: input.apiToken,
        fetchImpl: input.fetchImpl
      });

      const match = permissionGroups.find((group) => group.name === r2ObjectReadWritePermissionName);
      if (!match) {
        errors.push(`${target.owner} token endpoint did not include "${r2ObjectReadWritePermissionName}".`);
        continue;
      }

      return { permissionGroup: match, target };
    } catch (error) {
      errors.push(`${target.owner} token endpoint: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to find Cloudflare permission group "${r2ObjectReadWritePermissionName}". ${errors.join(" ")}`);
}

async function createCloudflareApiToken(input: {
  apiToken: string;
  fetchImpl: typeof fetch;
  target: CloudflareTokenApiTarget;
  body: unknown;
}): Promise<CloudflareTokenResult> {
  return cloudflareRequest<CloudflareTokenResult>({
    path: input.target.basePath,
    method: "POST",
    apiToken: input.apiToken,
    fetchImpl: input.fetchImpl,
    body: input.body
  });
}

async function cloudflareRequest<T>(input: {
  path: string;
  method: string;
  apiToken: string;
  fetchImpl: typeof fetch;
  body?: unknown;
}): Promise<T> {
  const response = await input.fetchImpl(`${cloudflareApiBase}${input.path}`, {
    method: input.method,
    headers: {
      "authorization": `Bearer ${input.apiToken}`,
      "content-type": "application/json"
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body)
  });
  const json = await response.json() as CloudflareApiResponse<T>;

  if (!response.ok || !json.success || json.result === undefined) {
    const errorMessage = json.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(errorMessage || `Cloudflare API request failed: ${response.status}`);
  }

  return json.result;
}

function formatEnvValue(value: string): string {
  if (!value) {
    return "";
  }

  if (/[\s"'#]/.test(value)) {
    return JSON.stringify(value);
  }

  return value;
}

function runCommand(command: string, args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      resolve({ exitCode: null, stdout: Buffer.concat(stdout).toString("utf8"), stderr: error.message });
    });
    child.on("close", (exitCode) => {
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

async function openUrl(url: string): Promise<void> {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const result = await runCommand(command, args);

  if (result.exitCode !== 0) {
    throw new Error(`Unable to open ${url}.\n${result.stderr}`);
  }
}
