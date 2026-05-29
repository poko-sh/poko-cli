#!/usr/bin/env bun
import pc from "picocolors";
import { runCapture } from "./commands/capture.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runExport } from "./commands/export.ts";
import { runHandoff } from "./commands/handoff.ts";
import { runHistory } from "./commands/history.ts";
import { runInit } from "./commands/init.ts";
import { runSync } from "./commands/sync.ts";
import { createLogger, type Logger } from "./core/logger.ts";

type ParsedArgs = {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
};

export const run = async (
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  logger: Logger = createLogger(),
): Promise<number> => {
  const parsed = parseArgs(argv);

  if (!parsed.command) {
    logger.plain(helpText());
    return 0;
  }

  switch (parsed.command) {
    case "init":
      if (parsed.flags.help || parsed.flags.h) {
        logger.plain(initHelpText());
        return 0;
      }

      await runInit({
        cwd,
        force: Boolean(parsed.flags.force),
        yes: Boolean(parsed.flags.yes),
        logger,
      });
      return 0;
    case "sync":
      if (parsed.flags.help || parsed.flags.h) {
        logger.plain(syncHelpText());
        return 0;
      }

      await runSync({
        cwd,
        agent: flagString(parsed.flags.agent),
        all: Boolean(parsed.flags.all),
        dryRun: Boolean(parsed.flags["dry-run"]),
        noHistory: Boolean(parsed.flags["no-history"]),
        backup: Boolean(parsed.flags.backup),
        diff: Boolean(parsed.flags.diff),
        logger,
      });
      return 0;
    case "export":
      if (parsed.flags.help || parsed.flags.h) {
        logger.plain(exportHelpText());
        return 0;
      }

      await runExport({
        cwd,
        agent: parsed.positional[0],
        stdout: Boolean(parsed.flags.stdout),
        dryRun: Boolean(parsed.flags["dry-run"]),
        backup: Boolean(parsed.flags.backup),
        diff: Boolean(parsed.flags.diff),
        logger,
      });
      return 0;
    case "capture":
      if (parsed.flags.help || parsed.flags.h) {
        logger.plain(captureHelpText());
        return 0;
      }

      await runCapture({
        cwd,
        agent: parsed.positional[0],
        all: Boolean(parsed.flags.all),
        store: flagString(parsed.flags.store),
        dryRun: Boolean(parsed.flags["dry-run"]),
        includePrevious: Boolean(parsed.flags["include-previous"]),
        logger,
      });
      return 0;
    case "history":
      if (parsed.flags.help || parsed.flags.h) {
        logger.plain(historyHelpText());
        return 0;
      }

      await runHistory({
        cwd,
        store: flagString(parsed.flags.store),
        logger,
      });
      return 0;
    case "doctor":
      if (parsed.flags.help || parsed.flags.h) {
        logger.plain(doctorHelpText());
        return 0;
      }

      await runDoctor({
        cwd,
        logger,
      });
      return 0;
    case "status":
      if (parsed.flags.help || parsed.flags.h) {
        logger.plain(statusHelpText());
        return 0;
      }

      await runDoctor({
        cwd,
        logger,
        compact: true,
      });
      return 0;
    case "handoff":
      if (parsed.flags.help || parsed.flags.h) {
        logger.plain(handoffHelpText());
        return 0;
      }

      await runHandoff({
        cwd,
        agent: parsed.positional[0],
        store: flagString(parsed.flags.store),
        limit: flagString(parsed.flags.limit),
        raw: Boolean(parsed.flags.raw),
        stdout: Boolean(parsed.flags.stdout),
        logger,
      });
      return 0;
    default:
      throw new Error(
        `Unknown command "${parsed.command}". Run \`poko --help\`.`,
      );
  }
};

const parseArgs = (argv: string[]): ParsedArgs => {
  const command = argv[0]?.startsWith("-") ? undefined : argv[0];
  const rest = command ? argv.slice(1) : argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = arg.slice(2).split("=", 2);

      if (inlineValue !== undefined) {
        flags[rawKey] = inlineValue;
        continue;
      }

      const next = rest[index + 1];

      if (next && !next.startsWith("-") && expectsValue(rawKey)) {
        flags[rawKey] = next;
        index += 1;
        continue;
      }

      flags[rawKey] = true;
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      for (const key of arg.slice(1)) {
        flags[key] = true;
      }
      continue;
    }

    positional.push(arg);
  }

  return { command, positional, flags };
};

const expectsValue = (flag: string): boolean =>
  ["agent", "store", "limit"].includes(flag);

const flagString = (value: string | boolean | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

export const helpText =
  (): string => `${pc.bold("poko")} - your pocket context buddy

Usage:
  poko init [--yes] [--force]
  poko sync [--all] [--agent <agent>] [--dry-run] [--diff] [--backup] [--no-history]
  poko export <agent> [--stdout] [--dry-run] [--diff] [--backup]
  poko capture [agent|--all] [--store local|repo|both] [--dry-run] [--include-previous]
  poko history [--store local|repo|both]
  poko status
  poko doctor
  poko handoff <agent> [--stdout] [--raw] [--limit 5]

Agents:
  claude, cursor, antigravity, copilot, t3code, opencode, pi, hermes, openclaw, codex

Aliases:
  agy -> antigravity, vscode -> copilot, t3 -> t3code, oc -> opencode, pi-coding-agent -> pi, hermes-agent -> hermes, claw -> openclaw

Examples:
  poko init
  poko sync --all
  poko status
  poko doctor
  poko capture --all
  poko handoff cursor --stdout
  poko export antigravity --stdout
`;

const initHelpText = (): string => `${pc.bold("poko init")}

Creates .poko/ with git-friendly project context templates.

Options:
  --yes       Skip any future prompts
  --force     Overwrite existing .poko files
`;

const syncHelpText = (): string => `${pc.bold("poko sync")}

Detects installed/configured agents and writes their project context files and native chat history.

Options:
  --all             Sync every enabled adapter
  --agent <agent>   Sync one adapter
  --dry-run         Show what would change without writing files
  --diff            With --dry-run, print line-level static file changes
  --backup          Back up overwritten static files under .poko/backups/
  --no-history      Skip project chat/session history sync
`;

const exportHelpText = (): string => `${pc.bold("poko export <agent>")}

Renders one target agent without requiring the agent to be installed.

Options:
  --stdout          Print generated files instead of writing them
  --dry-run         Show what would change without writing files
  --diff            With --dry-run, print line-level static file changes
  --backup          Back up overwritten files under .poko/backups/
`;

const captureHelpText = (): string => `${pc.bold("poko capture [agent]")}

Captures raw local chat/session history for this project.

Agents:
  codex, claude, cursor, pi, hermes, openclaw

Options:
  --all             Capture every enabled history importer
  --store <store>   local, repo, or both
  --dry-run         Show what would be captured without writing history
  --include-previous
                   Include older same-path sessions from before .poko init
`;

const historyHelpText = (): string => `${pc.bold("poko history")}

Lists captured project sessions.

Options:
  --store <store>   local, repo, or both
`;

const doctorHelpText = (): string => `${pc.bold("poko doctor")}

Checks project context sources, adapter detection, captured history, and native sync dry-run details.
`;

const statusHelpText = (): string => `${pc.bold("poko status")}

Shows a compact readiness summary for the current project.
Use \`poko doctor\` when you want the full adapter and native sync report.
`;

const handoffHelpText = (): string => `${pc.bold("poko handoff <agent>")}

Creates an agent-friendly handoff from captured history.

Options:
  --stdout          Print instead of writing .poko/handoffs/<agent>-latest.md
  --raw             Include tool/system messages too
  --limit <count>   Number of recent sessions to include
  --store <store>   local, repo, or both
`;

if (import.meta.main) {
  const logger = createLogger();

  run(process.argv.slice(2), process.cwd(), logger).catch((error) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
