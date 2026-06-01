#!/usr/bin/env bun
import pc from "picocolors";
import { runCapture, runCaptureReport } from "./commands/capture.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runExport } from "./commands/export.ts";
import { runHandoff } from "./commands/handoff.ts";
import { runHistory, runHistoryReport } from "./commands/history.ts";
import { runInit } from "./commands/init.ts";
import { runSync, runSyncReport } from "./commands/sync.ts";
import {
  createLogger,
  createPrivateDisplayLogger,
  createSilentLogger,
  type Logger,
  redactPersonalInfo,
} from "./core/logger.ts";

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
  const json = Boolean(parsed.flags.json);
  const privateDisplay = shouldUsePrivateDisplay(parsed.flags);
  const outputLogger = privateDisplay
    ? createPrivateDisplayLogger(logger)
    : logger;

  try {
    if (!parsed.command) {
      outputLogger.plain(helpText());
      return 0;
    }

    switch (parsed.command) {
      case "init":
        if (parsed.flags.help || parsed.flags.h) {
          outputLogger.plain(initHelpText());
          return 0;
        }

        await runInit({
          cwd,
          force: Boolean(parsed.flags.force),
          yes: Boolean(parsed.flags.yes),
          logger: outputLogger,
        });
        return 0;
      case "sync":
        if (parsed.flags.help || parsed.flags.h) {
          outputLogger.plain(syncHelpText());
          return 0;
        }

        if (json) {
          const report = await runSyncReport({
            cwd,
            agent: flagString(parsed.flags.agent),
            all: Boolean(parsed.flags.all),
            global: Boolean(parsed.flags.global),
            dryRun: Boolean(parsed.flags["dry-run"]),
            noHistory: Boolean(parsed.flags["no-history"]),
            backup: Boolean(parsed.flags.backup),
            diff: Boolean(parsed.flags.diff),
            quiet: true,
            logger: createSilentLogger(),
          });
          outputLogger.plain(toJson(report));
          return 0;
        }

        await runSync({
          cwd,
          agent: flagString(parsed.flags.agent),
          all: Boolean(parsed.flags.all),
          global: Boolean(parsed.flags.global),
          dryRun: Boolean(parsed.flags["dry-run"]),
          noHistory: Boolean(parsed.flags["no-history"]),
          backup: Boolean(parsed.flags.backup),
          diff: Boolean(parsed.flags.diff),
          logger: outputLogger,
        });
        return 0;
      case "export":
        if (parsed.flags.help || parsed.flags.h) {
          outputLogger.plain(exportHelpText());
          return 0;
        }

        await runExport({
          cwd,
          agent: parsed.positional[0],
          stdout: Boolean(parsed.flags.stdout),
          dryRun: Boolean(parsed.flags["dry-run"]),
          backup: Boolean(parsed.flags.backup),
          diff: Boolean(parsed.flags.diff),
          logger: outputLogger,
        });
        return 0;
      case "capture":
        if (parsed.flags.help || parsed.flags.h) {
          outputLogger.plain(captureHelpText());
          return 0;
        }

        if (json) {
          const report = await runCaptureReport({
            cwd,
            agent: parsed.positional[0],
            all: Boolean(parsed.flags.all),
            store: flagString(parsed.flags.store),
            dryRun: Boolean(parsed.flags["dry-run"]),
            includePrevious: Boolean(parsed.flags["include-previous"]),
            quiet: true,
            logger: createSilentLogger(),
          });
          outputLogger.plain(toJson(report));
          return 0;
        }

        await runCapture({
          cwd,
          agent: parsed.positional[0],
          all: Boolean(parsed.flags.all),
          store: flagString(parsed.flags.store),
          dryRun: Boolean(parsed.flags["dry-run"]),
          includePrevious: Boolean(parsed.flags["include-previous"]),
          logger: outputLogger,
        });
        return 0;
      case "history":
        if (parsed.flags.help || parsed.flags.h) {
          outputLogger.plain(historyHelpText());
          return 0;
        }

        if (json) {
          const report = await runHistoryReport({
            cwd,
            store: flagString(parsed.flags.store),
            raw: Boolean(parsed.flags.raw),
            limit: flagString(parsed.flags.limit),
            quiet: true,
            logger: createSilentLogger(),
          });
          outputLogger.plain(toJson(report));
          return 0;
        }

        await runHistory({
          cwd,
          store: flagString(parsed.flags.store),
          raw: Boolean(parsed.flags.raw),
          limit: flagString(parsed.flags.limit),
          logger: outputLogger,
        });
        return 0;
      case "doctor":
        if (parsed.flags.help || parsed.flags.h) {
          outputLogger.plain(doctorHelpText());
          return 0;
        }

        if (json) {
          const report = await runDoctor({
            cwd,
            logger: createSilentLogger(),
          });
          outputLogger.plain(
            toJson(report ?? uninitializedReport("doctor", cwd)),
          );
          return 0;
        }

        await runDoctor({
          cwd,
          logger: outputLogger,
        });
        return 0;
      case "status":
        if (parsed.flags.help || parsed.flags.h) {
          outputLogger.plain(statusHelpText());
          return 0;
        }

        if (json) {
          const report = await runDoctor({
            cwd,
            logger: createSilentLogger(),
            compact: true,
          });
          outputLogger.plain(
            toJson(
              report
                ? { ...report, command: "status" }
                : uninitializedReport("status", cwd),
            ),
          );
          return 0;
        }

        await runDoctor({
          cwd,
          logger: outputLogger,
          compact: true,
        });
        return 0;
      case "handoff":
        if (parsed.flags.help || parsed.flags.h) {
          outputLogger.plain(handoffHelpText());
          return 0;
        }

        await runHandoff({
          cwd,
          agent: parsed.positional[0],
          store: flagString(parsed.flags.store),
          limit: flagString(parsed.flags.limit),
          raw: Boolean(parsed.flags.raw),
          stdout: Boolean(parsed.flags.stdout),
          logger: outputLogger,
        });
        return 0;
      default:
        throw new Error(
          `Unknown command "${parsed.command}". Run \`poko --help\`.`,
        );
    }
  } catch (error) {
    if (!privateDisplay) {
      throw error;
    }

    throw redactThrownError(error);
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

const shouldUsePrivateDisplay = (
  flags: Record<string, string | boolean>,
): boolean =>
  Boolean(flags["private-display"] || flags["hide-personal-info"]) ||
  process.env.POKO_PRIVATE_DISPLAY === "1";

const redactThrownError = (error: unknown): Error => {
  const source = error instanceof Error ? error : new Error(String(error));
  const redacted = new Error(redactPersonalInfo(source.message));
  redacted.name = source.name;

  if (source.stack) {
    redacted.stack = redactPersonalInfo(source.stack);
  }

  return redacted;
};

const toJson = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

const uninitializedReport = (command: string, cwd: string) => ({
  schemaVersion: 1,
  command,
  generatedAt: new Date().toISOString(),
  initialized: false,
  root: cwd,
  message: "Run `poko init` to create .poko/poko.json.",
});

export const helpText =
  (): string => `${pc.bold("poko")} - your pocket context buddy

Usage:
  poko init [--yes] [--force]
  poko sync [--all] [--agent <agent>] [--dry-run] [--diff] [--backup] [--no-history] [--json]
  poko sync --global [--all] [--agent <agent>] [--dry-run] [--json]
  poko export <agent> [--stdout] [--dry-run] [--diff] [--backup]
  poko capture [agent|--all] [--store local|repo|both] [--dry-run] [--include-previous] [--json]
  poko history [--store local|repo|both] [--raw] [--limit <count>] [--json]
  poko status [--json]
  poko doctor [--json]
  poko handoff <agent> [--stdout] [--raw] [--limit 5]

Global options:
  --private-display      Hide email-like values in CLI output

Agents:
  claude, cursor, antigravity, copilot, t3code, opencode, pi, hermes, openclaw, codex

Aliases:
  agy -> antigravity, vscode -> copilot, t3 -> t3code, oc -> opencode, pi-coding-agent -> pi, hermes-agent -> hermes, claw -> openclaw

Examples:
  poko init
  poko sync --all
  poko sync --global --all --dry-run
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
With --global, syncs all locally discoverable project chat history into native agent stores.

Options:
  --all             Sync every enabled adapter
  --agent <agent>   Sync one adapter
  --global          Sync all discoverable local project histories; no static files are written
  --dry-run         Show what would change without writing files
  --diff            With --dry-run, print line-level static file changes
  --backup          Back up overwritten static files under .poko/backups/
  --no-history      Skip project chat/session history sync
  --json            Print machine-readable sync report
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
  --json            Print machine-readable capture report
`;

const historyHelpText = (): string => `${pc.bold("poko history")}

Lists captured project sessions.

Options:
  --store <store>   local, repo, or both
  --raw             Include raw session payloads in JSON output
  --limit <count>   Limit the number of sessions returned
  --json            Print machine-readable history index
`;

const doctorHelpText = (): string => `${pc.bold("poko doctor")}

Checks project context sources, adapter detection, captured history, and native sync dry-run details.

Options:
  --json            Print machine-readable doctor report
`;

const statusHelpText = (): string => `${pc.bold("poko status")}

Shows a compact readiness summary for the current project.
Use \`poko doctor\` when you want the full adapter and native sync report.

Options:
  --json            Print machine-readable status report
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
  const rawLogger = createLogger();
  const logger = shouldUsePrivateDisplay(parseArgs(process.argv.slice(2)).flags)
    ? createPrivateDisplayLogger(rawLogger)
    : rawLogger;

  run(process.argv.slice(2), process.cwd(), logger).catch((error) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
