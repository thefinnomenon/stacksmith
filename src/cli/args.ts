export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (!arg) {
      continue;
    }

    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      const [key, inlineValue] = raw.split("=", 2);

      if (!key) {
        continue;
      }

      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
        continue;
      }

      const next = rest[index + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { command, positionals, flags };
}

export function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

export function flagBoolean(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === "true";
}
