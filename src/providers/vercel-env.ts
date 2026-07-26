import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { EnvironmentName, ProjectManifest } from "../core/types.js";

export const r2VercelEnvKeys = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
  "FILES_URL",
  "R2_PREFIX"
] as const;

export type R2VercelEnvKey = typeof r2VercelEnvKeys[number];
export type VercelEnvironment = "development" | "preview" | "production";

export interface VercelEnvTarget {
  stacksmithEnvironment: EnvironmentName;
  vercelEnvironment: VercelEnvironment;
  gitBranch?: string;
}

export interface VercelR2EnvOptions {
  manifest: ProjectManifest;
  environment: EnvironmentName;
  envPath?: string;
  project?: string;
  scope?: string;
  execute?: boolean;
  runner?: CommandRunner;
}

export interface VercelR2EnvResult {
  status: "planned" | "synced" | "deleted";
  project: string;
  scope?: string;
  target: VercelEnvTarget;
  envPath: string;
  keys: R2VercelEnvKey[];
  message: string;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[], options?: {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
}) => Promise<CommandResult>;

export function vercelTargetForEnvironment(environment: EnvironmentName): VercelEnvTarget {
  if (environment === "production") {
    return {
      stacksmithEnvironment: environment,
      vercelEnvironment: "production"
    };
  }

  if (environment === "development") {
    return {
      stacksmithEnvironment: environment,
      vercelEnvironment: "development"
    };
  }

  return {
    stacksmithEnvironment: environment,
    vercelEnvironment: "preview",
    gitBranch: environment === "staging" ? "staging" : undefined
  };
}

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match?.[1]) {
      continue;
    }

    values[match[1]] = parseEnvValue(match[2] ?? "");
  }

  return values;
}

export function requiredR2EnvValues(values: Record<string, string>): Record<R2VercelEnvKey, string> {
  const missing = r2VercelEnvKeys.filter((key) => values[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing R2 env value(s): ${missing.join(", ")}`);
  }

  return Object.fromEntries(r2VercelEnvKeys.map((key) => [key, values[key] ?? ""])) as Record<R2VercelEnvKey, string>;
}

export function parseVercelEnvListNames(stdout: string): string[] {
  const parsed = JSON.parse(stdout) as unknown;
  const candidates = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.values(parsed).find((value) => Array.isArray(value)) ?? []
      : [];

  return candidates
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (typeof item === "object" && item !== null && "key" in item && typeof item.key === "string") {
        return item.key;
      }

      if (typeof item === "object" && item !== null && "name" in item && typeof item.name === "string") {
        return item.name;
      }

      return undefined;
    })
    .filter((value): value is string => Boolean(value));
}

export async function syncVercelR2Env(options: VercelR2EnvOptions): Promise<VercelR2EnvResult> {
  const target = vercelTargetForEnvironment(options.environment);
  const envPath = options.envPath ?? ".env.local";
  const project = options.project ?? options.manifest.slug;
  const scope = options.scope ?? options.manifest.providers.vercel.team;

  if (!options.execute) {
    return {
      status: "planned",
      project,
      scope,
      target,
      envPath,
      keys: [...r2VercelEnvKeys],
      message: `Dry run only. Re-run with --execute to sync ${r2VercelEnvKeys.length} R2 env var(s) to Vercel.`
    };
  }

  const envValues = requiredR2EnvValues(parseEnvFile(await readFile(envPath, "utf8")));
  const runner = options.runner ?? runCommand;

  for (const key of r2VercelEnvKeys) {
    await runVercelEnvAdd({
      runner,
      project,
      scope,
      target,
      key,
      value: envValues[key],
      sensitive: key === "R2_SECRET_ACCESS_KEY"
    });
  }

  return {
    status: "synced",
    project,
    scope,
    target,
    envPath,
    keys: [...r2VercelEnvKeys],
    message: `Synced ${r2VercelEnvKeys.length} R2 env var(s) to Vercel ${target.vercelEnvironment}.`
  };
}

export async function deleteVercelR2Env(options: VercelR2EnvOptions): Promise<VercelR2EnvResult> {
  const target = vercelTargetForEnvironment(options.environment);
  const envPath = options.envPath ?? ".env.local";
  const project = options.project ?? options.manifest.slug;
  const scope = options.scope ?? options.manifest.providers.vercel.team;

  if (!options.execute) {
    return {
      status: "planned",
      project,
      scope,
      target,
      envPath,
      keys: [...r2VercelEnvKeys],
      message: `Dry run only. Re-run with --execute to delete ${r2VercelEnvKeys.length} R2 env var(s) from Vercel.`
    };
  }

  const runner = options.runner ?? runCommand;
  for (const key of r2VercelEnvKeys) {
    await runVercelEnvRemove({ runner, project, scope, target, key });
  }

  return {
    status: "deleted",
    project,
    scope,
    target,
    envPath,
    keys: [...r2VercelEnvKeys],
    message: `Deleted ${r2VercelEnvKeys.length} R2 env var(s) from Vercel ${target.vercelEnvironment}.`
  };
}

export async function listVercelEnvNames(options: Omit<VercelR2EnvOptions, "envPath" | "execute">): Promise<string[]> {
  const target = vercelTargetForEnvironment(options.environment);
  const project = options.project ?? options.manifest.slug;
  const scope = options.scope ?? options.manifest.providers.vercel.team;
  const runner = options.runner ?? runCommand;
  const result = await runner("vercel", [
    "env",
    "list",
    target.vercelEnvironment,
    ...targetGitBranchArg(target),
    "--project",
    project,
    "--format",
    "json",
    ...scopeArgs(scope)
  ]);

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "Vercel env list failed.");
  }

  return parseVercelEnvListNames(result.stdout);
}

async function runVercelEnvAdd(input: {
  runner: CommandRunner;
  project: string;
  scope?: string;
  target: VercelEnvTarget;
  key: R2VercelEnvKey;
  value: string;
  sensitive: boolean;
}): Promise<void> {
  const result = await input.runner("vercel", [
    "env",
    "add",
    input.key,
    input.target.vercelEnvironment,
    ...targetGitBranchArg(input.target),
    "--project",
    input.project,
    "--force",
    "--yes",
    ...(input.sensitive && input.target.vercelEnvironment !== "development" ? ["--sensitive"] : []),
    ...scopeArgs(input.scope)
  ], { stdin: `${input.value}\n` });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `Failed to sync ${input.key} to Vercel.`);
  }
}

async function runVercelEnvRemove(input: {
  runner: CommandRunner;
  project: string;
  scope?: string;
  target: VercelEnvTarget;
  key: R2VercelEnvKey;
}): Promise<void> {
  const result = await input.runner("vercel", [
    "env",
    "remove",
    input.key,
    input.target.vercelEnvironment,
    ...targetGitBranchArg(input.target),
    "--project",
    input.project,
    "--yes",
    ...scopeArgs(input.scope)
  ]);

  const alreadyAbsent = /not found|does not exist|could not find/i.test(`${result.stdout}\n${result.stderr}`);
  if (result.exitCode !== 0 && !alreadyAbsent) {
    throw new Error(result.stderr || result.stdout || `Failed to delete ${input.key} from Vercel.`);
  }
}

function targetGitBranchArg(target: VercelEnvTarget): string[] {
  return target.gitBranch ? [target.gitBranch] : [];
}

function scopeArgs(scope: string | undefined): string[] {
  return scope ? ["--scope", scope] : [];
}

function parseEnvValue(value: string): string {
  if (value.startsWith("\"")) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }

  return value;
}

function runCommand(command: string, args: string[], options?: {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...options?.env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      resolve({
        exitCode: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: error.message
      });
    });
    child.on("close", (exitCode) => {
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });

    if (options?.stdin !== undefined) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}
