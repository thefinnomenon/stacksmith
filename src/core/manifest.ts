import { access } from "node:fs/promises";
import { createDefaultManifest } from "./defaults.js";
import { DEFAULT_MANIFEST_PATH, readJsonFile, resolveProjectPath, writeJsonFile } from "./files.js";
import type { ProjectManifest } from "./types.js";

export async function loadManifest(path?: string): Promise<ProjectManifest> {
  return readJsonFile<ProjectManifest>(resolveProjectPath(path, DEFAULT_MANIFEST_PATH));
}

export async function saveManifest(manifest: ProjectManifest, path?: string): Promise<void> {
  await writeJsonFile(resolveProjectPath(path, DEFAULT_MANIFEST_PATH), manifest);
}

export async function manifestExists(path?: string): Promise<boolean> {
  try {
    await access(resolveProjectPath(path, DEFAULT_MANIFEST_PATH));
    return true;
  } catch {
    return false;
  }
}

export async function initializeManifest(input: {
  name: string;
  domain?: string;
  baseDomain?: string;
  projectSubdomain?: string;
  backendMode?: ProjectManifest["backendMode"];
  path?: string;
}): Promise<ProjectManifest> {
  const manifest = createDefaultManifest(input);
  await saveManifest(manifest, input.path);
  return manifest;
}
