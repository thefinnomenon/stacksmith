import { spawn } from "node:child_process";
import type { ChangeRisk, ProviderId } from "./types.js";

export interface ExternalCommandInvocation {
  command: string;
  args: string[];
  env?: string[];
  stdinFromEnv?: string;
  stdin?: string;
}

export interface ExternalCommandCheck extends ExternalCommandInvocation {
  description: string;
  expectedExitCode?: number;
  stdoutIncludes?: string;
}

export interface ExternalCommandUndo extends ExternalCommandInvocation {
  description: string;
  risk: ChangeRisk;
  requiresConfirmation: boolean;
  check?: ExternalCommandCheck;
}

export interface ExternalCommand extends ExternalCommandInvocation {
  provider: ProviderId;
  id: string;
  description: string;
  risk: ChangeRisk;
  requiresConfirmation: boolean;
  check?: ExternalCommandCheck;
  undo?: ExternalCommandUndo;
}

export interface CommandRunResult {
  commandId: string;
  status: "planned" | "skipped" | "executed" | "failed" | "not-implemented";
  message: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}

export function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function formatCommandInvocation(command: ExternalCommandInvocation): string {
  return [command.command, ...command.args].map(shellQuote).join(" ");
}

export function formatExternalCommand(command: ExternalCommand, mode: "apply" | "undo" = "apply"): string {
  if (mode === "undo") {
    return command.undo ? formatCommandInvocation(command.undo) : "<no undo command>";
  }

  return formatCommandInvocation(command);
}

function expandEnvPlaceholders(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$([A-Z0-9_]+)/g, (_match, name: string) => env[name] ?? "");
}

export async function runExternalCommandDryRun(command: ExternalCommand): Promise<CommandRunResult> {
  return {
    commandId: command.id,
    status: "planned",
    message: `Prepared external command only: ${formatExternalCommand(command)}`
  };
}

export function missingCommandEnv(command: ExternalCommandInvocation, env: NodeJS.ProcessEnv = process.env): string[] {
  return (command.env ?? []).filter((name) => !env[name]);
}

async function spawnCommand(command: ExternalCommandInvocation, env: NodeJS.ProcessEnv): Promise<CommandRunResult> {
  return new Promise((resolve) => {
    const resolvedArgs = command.args.map((arg) => expandEnvPlaceholders(arg, env));
    const child = spawn(command.command, resolvedArgs, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      resolve({
        commandId: "external",
        status: "failed",
        message: error.message,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
    child.on("close", (exitCode) => {
      const rendered = formatCommandInvocation(command);
      resolve({
        commandId: "external",
        status: exitCode === 0 ? "executed" : "failed",
        exitCode,
        message: exitCode === 0 ? `Executed ${rendered}` : `Command failed: ${rendered}`,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });

    if (command.stdin !== undefined) {
      child.stdin.write(command.stdin);
    } else if (command.stdinFromEnv) {
      child.stdin.write(env[command.stdinFromEnv] ?? "");
    }
    child.stdin.end();
  });
}

async function commandCheckPasses(check: ExternalCommandCheck, env: NodeJS.ProcessEnv): Promise<boolean> {
  const result = await spawnCommand(check, env);
  const expectedExitCode = check.expectedExitCode ?? 0;
  if (result.exitCode !== expectedExitCode) {
    return false;
  }

  return check.stdoutIncludes
    ? Boolean(result.stdout?.toLowerCase().includes(check.stdoutIncludes.toLowerCase()))
    : true;
}

export async function runExternalCommand(input: {
  command: ExternalCommand;
  execute: boolean;
  mode?: "apply" | "undo";
  env?: NodeJS.ProcessEnv;
}): Promise<CommandRunResult> {
  const mode = input.mode ?? "apply";
  if (!input.execute) {
    if (mode === "undo") {
      return input.command.undo
        ? {
            commandId: input.command.id,
            status: "planned",
            message: `Prepared undo command only: ${formatExternalCommand(input.command, "undo")}`
          }
        : {
            commandId: input.command.id,
            status: "not-implemented",
            message: "No undo command is defined for this operation."
          };
    }

    return runExternalCommandDryRun(input.command);
  }

  const env = input.env ?? process.env;
  const targetCommand = mode === "undo" ? input.command.undo : input.command;
  if (!targetCommand) {
    return {
      commandId: input.command.id,
      status: "not-implemented",
      message: "No undo command is defined for this operation."
    };
  }

  const idempotencyCheck = mode === "undo"
    ? input.command.undo?.check ?? input.command.check
    : input.command.check;

  if (idempotencyCheck) {
    const missingCheck = missingCommandEnv(idempotencyCheck, env);
    if (missingCheck.length === 0) {
      const alreadyExists = await commandCheckPasses(idempotencyCheck, env);
      if (mode === "apply" && alreadyExists) {
        return {
          commandId: input.command.id,
          status: "skipped",
          message: `Already satisfied: ${idempotencyCheck.description}`
        };
      }

      if (mode === "undo" && !alreadyExists) {
        return {
          commandId: input.command.id,
          status: "skipped",
          message: `Already absent: ${idempotencyCheck.description}`
        };
      }
    }
  }

  const missing = missingCommandEnv(targetCommand, env);
  if (missing.length > 0) {
    return {
      commandId: input.command.id,
      status: "skipped",
      message: `Missing required environment variable(s): ${missing.join(", ")}`
    };
  }

  const result = await spawnCommand(targetCommand, env);
  return { ...result, commandId: input.command.id };
}

export function orderExternalCommandsForExecution(
  commands: ExternalCommand[],
  mode: "apply" | "undo"
): ExternalCommand[] {
  return mode === "undo" ? [...commands].reverse() : commands;
}
