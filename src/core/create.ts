import { join, resolve } from "node:path";
import { createDefaultManifest, slugify } from "./defaults.js";
import { DEFAULT_MANIFEST_PATH, DEFAULT_STATE_PATH } from "./files.js";
import { saveManifest } from "./manifest.js";
import { createInitialState, saveState } from "./state.js";
import type { ProjectManifest } from "./types.js";
import { generateAppSkeleton, type GenerateAppResult } from "../templates/app.js";

export interface CreateProjectInput {
  name: string;
  domain?: string;
  baseDomain?: string;
  projectSubdomain?: string;
  backendMode?: ProjectManifest["backendMode"];
  targetDir?: string;
  force?: boolean;
}

export interface CreateProjectResult {
  manifest: ProjectManifest;
  root: string;
  manifestPath: string;
  statePath: string;
  app: GenerateAppResult;
}

export function defaultCreateTargetDir(name: string): string {
  return `./${slugify(name)}`;
}

export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const manifest = createDefaultManifest({
    name: input.name,
    domain: input.domain,
    baseDomain: input.baseDomain,
    projectSubdomain: input.projectSubdomain,
    backendMode: input.backendMode
  });
  const root = resolve(input.targetDir ?? defaultCreateTargetDir(input.name));
  const manifestPath = join(root, DEFAULT_MANIFEST_PATH);
  const statePath = join(root, DEFAULT_STATE_PATH);
  const state = createInitialState(manifest);

  await saveManifest(manifest, manifestPath);
  await saveState(state, statePath);
  const app = await generateAppSkeleton({
    manifest,
    targetDir: root,
    force: input.force
  });

  return {
    manifest,
    root,
    manifestPath,
    statePath,
    app
  };
}
