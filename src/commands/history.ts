import { parseStore } from "../core/agent-parse.ts";
import { loadPokoConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { loadHistoryIndex, loadHistorySessions } from "../history/storage.ts";
import type { HistoryStore, RawHistorySession } from "../history/types.ts";

export type HistoryOptions = {
  cwd: string;
  store?: string;
  raw?: boolean;
  limit?: string;
  quiet?: boolean;
  logger: Logger;
};

export const runHistory = async (options: HistoryOptions): Promise<number> => {
  const report = await runHistoryReport(options);
  return report.entries.length;
};

export type HistoryReport = {
  schemaVersion: 1;
  command: "history";
  generatedAt: string;
  root: string;
  store: HistoryStore;
  sessions?: RawHistorySession[];
  entries: Array<{
    id: string;
    projectId?: string;
    sourceAgent: string;
    title: string;
    projectRoot: string;
    createdAt?: string;
    updatedAt?: string;
    messageCount: number;
    path: string;
  }>;
};

export const runHistoryReport = async (
  options: HistoryOptions,
): Promise<HistoryReport> => {
  const config = await loadPokoConfig(options.cwd);
  const store = parseStore(options.store ?? config.history.defaultStore);
  const limit = parseLimit(options.limit);
  const entries = (
    await loadHistoryIndex(options.cwd, store, config.project.id)
  ).slice(0, limit ?? undefined);
  const sessions = options.raw
    ? await loadHistorySessions(
        options.cwd,
        store,
        limit ?? entries.length,
        config.project.id,
      )
    : undefined;

  if (entries.length === 0) {
    if (!options.quiet) {
      options.logger.warn("no captured history yet. Try `poko capture --all`.");
    }

    return {
      schemaVersion: 1,
      command: "history",
      generatedAt: new Date().toISOString(),
      root: options.cwd,
      store,
      sessions,
      entries: [],
    };
  }

  if (!options.quiet) {
    for (const entry of entries) {
      options.logger.plain(
        `${entry.updatedAt ?? entry.createdAt ?? "unknown"}  ${entry.sourceAgent}  ${entry.messageCount} msg  ${entry.title}`,
      );
    }
  }

  return {
    schemaVersion: 1,
    command: "history",
    generatedAt: new Date().toISOString(),
    root: options.cwd,
    store,
    sessions,
    entries,
  };
};

const parseLimit = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("History limit must be a positive integer.");
  }

  return parsed;
};
