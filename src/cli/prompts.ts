import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface InitAnswers {
  name: string;
  domain?: string;
  baseDomain?: string;
  projectSubdomain?: string;
  backendMode: "next-only" | "worker" | "hybrid";
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

    return { name, domain, baseDomain, projectSubdomain, backendMode };
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

    return { name, targetDir, domain, baseDomain, projectSubdomain, backendMode };
  } finally {
    rl.close();
  }
}
