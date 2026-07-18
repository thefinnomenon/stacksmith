#!/usr/bin/env node
import { printPostgresSchema } from "./db/schema.js";
import { flagBoolean, flagString, parseArgs } from "./cli/args.js";
import { formatDoctor, formatHealth, formatPlan } from "./cli/format.js";
import { promptForCreate, promptForInit } from "./cli/prompts.js";
import { createProject, defaultCreateTargetDir } from "./core/create.js";
import { formatDomainPromotionPlan, planDomainPromotion } from "./core/domain.js";
import { formatDevSessionPlan, planDevSession } from "./core/dev.js";
import { runDoctor } from "./core/doctor.js";
import { DEFAULT_MANIFEST_PATH, DEFAULT_STATE_PATH } from "./core/files.js";
import { initializeManifest, loadManifest, manifestExists } from "./core/manifest.js";
import { applyAll, filterProviderChanges, planAll, healthAll } from "./core/orchestrator.js";
import { loadState, saveState } from "./core/state.js";
import type { ProjectManifest, ProviderId } from "./core/types.js";
import { listMcpTools } from "./operations/mcp.js";
import { buildNotificationSlackMessage, createNotificationEvent } from "./operations/notifications.js";
import { sendSlackMessage } from "./operations/slack-sender.js";
import { generateAppSkeleton } from "./templates/app.js";
import { allProviderCommandPlans } from "./providers/command-plans.js";
import { formatExternalCommand, runExternalCommand } from "./core/commands.js";

function help(): string {
  return [
    "stacksmith <command>",
    "",
    "Commands:",
    "  create [name] [target-dir] [--domain example.com | --base-domain example.com] [--project-subdomain name] [--backend hybrid|worker|next-only] [--force] [--interactive]",
    "  init [name] [--domain example.com] [--backend hybrid|worker|next-only] [--interactive]",
    "  plan [--json] [--manifest path] [--state path]",
    "  apply --yes [--provider github,vercel] [--manifest path] [--state path]",
    "  doctor [--json]",
    "  health [--json]",
    "  dev [--json]",
    "  commands [--json] [--provider github] [--id command.id] [--execute] [--undo]",
    "  domain promote <domain> [--json]",
    "  notify-slack --channel C123 [--execute]",
    "  schema",
    "  mcp-tools [--json]",
    "  noop [reason]",
    "",
    "Phase 1 is local-only: provider adapters record scaffold state and do not call vendor APIs."
  ].join("\n");
}

function providerIds(value: string | undefined): ProviderId[] | undefined {
  if (!value) {
    return undefined;
  }

  return value.split(",").map((item) => item.trim()).filter(Boolean) as ProviderId[];
}

async function loadProject(flags: Record<string, string | boolean>) {
  const manifestPath = flagString(flags, "manifest");
  const statePath = flagString(flags, "state");
  const manifest = await loadManifest(manifestPath);
  const state = await loadState(manifest, statePath);
  return { manifest, state, manifestPath, statePath };
}

async function run(argv: string[]): Promise<string> {
  const parsed = parseArgs(argv);

  switch (parsed.command) {
    case "help":
    case "--help":
    case "-h":
      return help();

    case "init": {
      const interactive = flagBoolean(parsed.flags, "interactive") || !parsed.positionals[0];
      const answers = interactive
        ? await promptForInit(parsed.positionals[0])
        : {
            name: parsed.positionals[0] ?? "",
            domain: flagString(parsed.flags, "domain"),
            baseDomain: flagString(parsed.flags, "base-domain"),
            projectSubdomain: flagString(parsed.flags, "project-subdomain"),
            backendMode: (flagString(parsed.flags, "backend") ?? "hybrid") as ProjectManifest["backendMode"]
          };

      const manifest = await initializeManifest({
        name: answers.name,
        domain: answers.domain,
        baseDomain: answers.baseDomain,
        projectSubdomain: answers.projectSubdomain,
        backendMode: answers.backendMode,
        path: flagString(parsed.flags, "manifest")
      });
      const state = await loadState(manifest, flagString(parsed.flags, "state"));
      await saveState(state, flagString(parsed.flags, "state"));

      return [
        `Created ${DEFAULT_MANIFEST_PATH} for ${manifest.name}.`,
        `Created ${DEFAULT_STATE_PATH} scaffold state.`,
        "Run `stacksmith create` for the full app scaffold, or `stacksmith plan` to inspect provider state."
      ].join("\n");
    }

    case "create": {
      const positionalName = parsed.positionals[0];
      const positionalTarget = parsed.positionals[1];
      const interactive = flagBoolean(parsed.flags, "interactive") || !positionalName;
      const answers = interactive
        ? await promptForCreate(positionalName, positionalTarget)
        : {
            name: positionalName,
            targetDir: positionalTarget ?? flagString(parsed.flags, "target") ?? defaultCreateTargetDir(positionalName),
            domain: flagString(parsed.flags, "domain"),
            baseDomain: flagString(parsed.flags, "base-domain"),
            projectSubdomain: flagString(parsed.flags, "project-subdomain"),
            backendMode: (flagString(parsed.flags, "backend") ?? "hybrid") as ProjectManifest["backendMode"]
          };

      const result = await createProject({
        name: answers.name,
        domain: answers.domain,
        baseDomain: answers.baseDomain,
        projectSubdomain: answers.projectSubdomain,
        backendMode: answers.backendMode,
        targetDir: answers.targetDir,
        force: flagBoolean(parsed.flags, "force")
      });

      return [
        `Created Stacksmith project at ${result.root}.`,
        `Manifest: ${result.manifestPath}`,
        `State: ${result.statePath}`,
        `App files written: ${result.app.written.length}`,
        `App files skipped: ${result.app.skipped.length}`,
        "Next: cd into the project and run `stacksmith doctor`."
      ].join("\n");
    }

    case "plan": {
      const { manifest, state } = await loadProject(parsed.flags);
      const plan = await planAll(manifest, state);
      return flagBoolean(parsed.flags, "json") ? JSON.stringify(plan, null, 2) : formatPlan(plan);
    }

    case "apply": {
      if (!flagBoolean(parsed.flags, "yes")) {
        throw new Error("Refusing to apply without --yes. Phase 1 still changes local state files.");
      }

      const { manifest, state, statePath } = await loadProject(parsed.flags);
      const plan = await planAll(manifest, state);
      const changes = filterProviderChanges(plan.changes, providerIds(flagString(parsed.flags, "provider")));
      const results = await applyAll(manifest, state, changes);
      await saveState(state, statePath);

      return [
        `Applied scaffold state for ${results.length} provider(s).`,
        "No real provider API calls were made."
      ].join("\n");
    }

    case "doctor": {
      if (!(await manifestExists(flagString(parsed.flags, "manifest")))) {
        return [
          "No project manifest found.",
          `Expected: ${flagString(parsed.flags, "manifest") ?? DEFAULT_MANIFEST_PATH}`,
          "Run `stacksmith create`."
        ].join("\n");
      }

      const { manifest, state } = await loadProject(parsed.flags);
      const doctor = await runDoctor({ manifest, state });
      return flagBoolean(parsed.flags, "json")
        ? JSON.stringify(doctor, null, 2)
        : formatDoctor(doctor);
    }

    case "health": {
      const { manifest, state } = await loadProject(parsed.flags);
      const results = await healthAll(manifest, state);
      return flagBoolean(parsed.flags, "json") ? JSON.stringify(results, null, 2) : formatHealth(results);
    }

    case "dev": {
      const { manifest } = await loadProject(parsed.flags);
      const plan = planDevSession(manifest);
      return flagBoolean(parsed.flags, "json")
        ? JSON.stringify(plan, null, 2)
        : formatDevSessionPlan(plan);
    }

    case "generate-app": {
      const targetDir = parsed.positionals[0];
      if (!targetDir) {
        throw new Error("generate-app requires a target directory. Prefer `stacksmith create` for new projects.");
      }

      const { manifest } = await loadProject(parsed.flags);
      const result = await generateAppSkeleton({
        manifest,
        targetDir,
        force: flagBoolean(parsed.flags, "force")
      });

      return [
        `Generated app skeleton at ${result.root}.`,
        `Written: ${result.written.length}`,
        `Skipped: ${result.skipped.length}`,
        result.skipped.length ? `Skipped existing files: ${result.skipped.join(", ")}` : ""
      ].filter(Boolean).join("\n");
    }

    case "commands": {
      const { manifest } = await loadProject(parsed.flags);
      const onlyProvider = providerIds(flagString(parsed.flags, "provider"));
      const onlyId = flagString(parsed.flags, "id");
      const commands = allProviderCommandPlans(manifest)
        .filter((command) => !onlyProvider?.length || onlyProvider.includes(command.provider))
        .filter((command) => !onlyId || command.id === onlyId);
      const execute = flagBoolean(parsed.flags, "execute");
      const mode = flagBoolean(parsed.flags, "undo") ? "undo" : "apply";

      if (execute) {
        const results = [];
        for (const command of commands) {
          results.push(await runExternalCommand({ command, execute, mode }));
        }

        return flagBoolean(parsed.flags, "json")
          ? JSON.stringify(results, null, 2)
          : results.map((result) => `${result.commandId}: ${result.status} - ${result.message}`).join("\n");
      }

      return flagBoolean(parsed.flags, "json")
        ? JSON.stringify(commands, null, 2)
        : commands.map((command) => `${command.id}: ${formatExternalCommand(command, mode)}`).join("\n");
    }

    case "domain": {
      const subcommand = parsed.positionals[0];
      if (subcommand !== "promote") {
        throw new Error("Unknown domain command. Use `stacksmith domain promote <domain>`.");
      }

      const domain = parsed.positionals[1];
      if (!domain) {
        throw new Error("domain promote requires a target domain.");
      }

      const { manifest } = await loadProject(parsed.flags);
      const plan = planDomainPromotion(manifest, domain);
      return flagBoolean(parsed.flags, "json")
        ? JSON.stringify(plan, null, 2)
        : formatDomainPromotionPlan(plan);
    }

    case "notify-slack": {
      const channel = flagString(parsed.flags, "channel") ?? process.env.SLACK_ALERTS_CHANNEL_ID;
      if (!channel) {
        throw new Error("notify-slack requires --channel or SLACK_ALERTS_CHANNEL_ID.");
      }

      const event = createNotificationEvent({
        projectId: "stacksmith",
        type: "preview.failed",
        severity: "warning",
        environment: "preview",
        title: "Stacksmith Slack test",
        summary: "This is a one-way notification test from Stacksmith."
      });
      const result = await sendSlackMessage({
        message: buildNotificationSlackMessage(event, channel),
        botToken: process.env.SLACK_BOT_TOKEN,
        execute: flagBoolean(parsed.flags, "execute")
      });

      return flagBoolean(parsed.flags, "json")
        ? JSON.stringify(result, null, 2)
        : `${result.status}: ${result.message}`;
    }

    case "schema":
      return printPostgresSchema();

    case "mcp-tools": {
      const tools = listMcpTools();
      return flagBoolean(parsed.flags, "json")
        ? JSON.stringify(tools, null, 2)
        : tools.map((tool) => `${tool.name}: ${tool.description}`).join("\n");
    }

    case "noop":
      return `No-op: ${parsed.positionals[0] ?? "nothing to do"}`;

    default:
      throw new Error(`Unknown command: ${parsed.command}\n\n${help()}`);
  }
}

run(process.argv.slice(2))
  .then((output) => {
    if (output) {
      console.log(output);
    }
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
