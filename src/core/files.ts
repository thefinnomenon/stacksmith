import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const DEFAULT_MANIFEST_PATH = ".stacksmith/project.json";
export const DEFAULT_STATE_PATH = ".stacksmith/state.json";

export async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const fullPath = resolve(path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function resolveProjectPath(path: string | undefined, fallback: string): string {
  return resolve(path ?? fallback);
}
