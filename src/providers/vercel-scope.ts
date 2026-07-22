import { spawn } from "node:child_process";

export interface VercelScope {
  id: string;
  name: string;
  selected: boolean;
}

export function parseVercelTeamsList(output: string): VercelScope[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("Vercel CLI") && !line.startsWith("Fetching") && !line.startsWith("id "))
    .map((line) => {
      const selected = line.startsWith("✔");
      const normalized = selected ? line.slice(1).trim() : line;
      const [id, ...nameParts] = normalized.split(/\s+/);

      return id
        ? {
            id,
            name: nameParts.join(" "),
            selected
          }
        : undefined;
    })
    .filter((scope): scope is VercelScope => Boolean(scope));
}

export async function listVercelScopes(): Promise<VercelScope[]> {
  return new Promise((resolve) => {
    const child = spawn("vercel", ["teams", "list"], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", () => resolve([]));
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        resolve([]);
        return;
      }

      resolve(parseVercelTeamsList(`${Buffer.concat(stdout).toString("utf8")}\n${Buffer.concat(stderr).toString("utf8")}`));
    });
  });
}
