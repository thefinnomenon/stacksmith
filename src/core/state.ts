import { access } from "node:fs/promises";
import { DEFAULT_STATE_PATH, readJsonFile, resolveProjectPath, writeJsonFile } from "./files.js";
import type { ProjectManifest, ProjectState } from "./types.js";

export function createInitialState(manifest: ProjectManifest): ProjectState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    projectSlug: manifest.slug,
    createdAt: now,
    updatedAt: now,
    providers: {}
  };
}

export async function loadState(manifest: ProjectManifest, path?: string): Promise<ProjectState> {
  const resolved = resolveProjectPath(path, DEFAULT_STATE_PATH);
  try {
    await access(resolved);
    return readJsonFile<ProjectState>(resolved);
  } catch {
    return createInitialState(manifest);
  }
}

export async function saveState(state: ProjectState, path?: string): Promise<void> {
  await writeJsonFile(resolveProjectPath(path, DEFAULT_STATE_PATH), {
    ...state,
    updatedAt: new Date().toISOString()
  });
}
