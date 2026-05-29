import { loadPokoConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { loadHistoryIndex } from "../history/storage.ts";
import type { HistoryStore } from "../history/types.ts";

export type HistoryOptions = {
  cwd: string;
  store?: string;
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
  const entries = await loadHistoryIndex(options.cwd, store, config.project.id);

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
    entries,
  };
};

const parseStore = (value: string): HistoryStore => {
  if (value === "local" || value === "repo" || value === "both") {
    return value;
  }

  throw new Error('History store must be one of "local", "repo", or "both".');
};
