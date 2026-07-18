import { spawn } from "node:child_process";

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export type CommandRunner = (command: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<ProcessResult>;

export const defaultCommandRunner: CommandRunner = async (command, args, env = process.env) => new Promise((resolve) => {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.on("error", (error) => {
    resolve({
      exitCode: null,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      error: error.message
    });
  });
  child.on("close", (exitCode) => {
    resolve({
      exitCode,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    });
  });
});
