import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { listVercelScopes, type VercelScope } from "../providers/vercel-scope.js";

export interface InitAnswers {
  name: string;
  domain?: string;
  baseDomain?: string;
  projectSubdomain?: string;
  backendMode: "next-only" | "worker" | "hybrid";
  vercelTeam?: string;
}

export interface CreateAnswers extends InitAnswers {
  targetDir: string;
}

export async function promptForInit(defaultName?: string): Promise<InitAnswers> {
  const rl = createInterface({ input, output });

  try {
    const name = (await rl.question(`Project name${defaultName ? ` (${defaultName})` : ""}: `)).trim() || defaultName;
    if (!name) {
      throw new Error("Project name is required.");
    }

    const domain = (await rl.question("Production domain (optional, e.g. push.com): ")).trim() || undefined;
    const baseDomain = domain ? undefined : (await rl.question("Base domain for project subdomain (optional, e.g. finternet.com): ")).trim() || undefined;
    const projectSubdomain = baseDomain ? (await rl.question(`Project subdomain (${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}): `)).trim() || undefined : undefined;
    const backend = (await rl.question("Backend mode [hybrid|worker|next-only] (hybrid): ")).trim();
    const backendMode = backend === "worker" || backend === "next-only" || backend === "hybrid" ? backend : "hybrid";
    const vercelTeam = await promptForVercelTeam(rl);

    return { name, domain, baseDomain, projectSubdomain, backendMode, vercelTeam };
  } finally {
    rl.close();
  }
}

export async function promptForCreate(defaultName?: string, defaultTargetDir?: string): Promise<CreateAnswers> {
  const rl = createInterface({ input, output });

  try {
    const name = (await rl.question(`Project name${defaultName ? ` (${defaultName})` : ""}: `)).trim() || defaultName;
    if (!name) {
      throw new Error("Project name is required.");
    }

    const targetDefault = defaultTargetDir ?? `./${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
    const targetDir = (await rl.question(`Target directory (${targetDefault}): `)).trim() || targetDefault;
    const domain = (await rl.question("Production domain (optional, e.g. push.com): ")).trim() || undefined;
    const baseDomain = domain ? undefined : (await rl.question("Base domain for project subdomain (optional, e.g. finternet.com): ")).trim() || undefined;
    const projectSubdomain = baseDomain ? (await rl.question(`Project subdomain (${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}): `)).trim() || undefined : undefined;
    const backend = (await rl.question("Backend mode [hybrid|worker|next-only] (hybrid): ")).trim();
    const backendMode = backend === "worker" || backend === "next-only" || backend === "hybrid" ? backend : "hybrid";
    const vercelTeam = await promptForVercelTeam(rl);

    return { name, targetDir, domain, baseDomain, projectSubdomain, backendMode, vercelTeam };
  } finally {
    rl.close();
  }
}

async function promptForVercelTeam(rl: ReturnType<typeof createInterface>): Promise<string | undefined> {
  const scopes = await listVercelScopes();

  if (scopes.length === 0) {
    const manual = (await rl.question("Vercel team/scope (optional): ")).trim();
    return manual || undefined;
  }

  if (scopes.length === 1) {
    return scopes[0]?.id;
  }

  output.write("\nVercel team/scope:\n");
  scopes.forEach((scope, index) => {
    output.write(`  ${index + 1}. ${formatScope(scope)}${scope.selected ? " (current)" : ""}\n`);
  });

  const selectedIndex = scopes.findIndex((scope) => scope.selected);
  const defaultChoice = selectedIndex >= 0 ? selectedIndex + 1 : 1;
  const answer = (await rl.question(`Choose Vercel team (${defaultChoice}): `)).trim();
  const parsed = Number.parseInt(answer, 10);
  const chosen = Number.isFinite(parsed) && parsed >= 1 && parsed <= scopes.length
    ? scopes[parsed - 1]
    : scopes[defaultChoice - 1];

  return chosen?.id;
}

function formatScope(scope: VercelScope): string {
  return scope.name ? `${scope.name} (${scope.id})` : scope.id;
}
