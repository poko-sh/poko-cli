import path from "node:path";
import { ADAPTERS } from "../adapters/index.ts";
import {
  loadPokoContext,
  POKO_DIR,
  type PokoContext,
  pathExists,
} from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import type { SourceState } from "../core/source-state.ts";
import { HISTORY_IMPORTERS } from "../history/importers/index.ts";
import { loadHistoryIndex } from "../history/storage.ts";
import { buildProjectSnapshot } from "./project-snapshot.ts";

export type StatusReport = {
  schemaVersion: 1;
  command: "status";
  generatedAt: string;
  project: {
    root: string;
    id: string;
    createdAt: string;
    historyStore: string;
    historyOnSync: boolean;
  };
  sourceContext: {
    text: Record<keyof PokoContext["sections"], SourceState>;
    mcp: { state: SourceState; servers: number };
    skills: number;
  };
  adapters: Array<{
    id: string;
    displayName: string;
    enabled: boolean;
    detected: boolean;
    reasons: string[];
  }>;
  history: {
    indexedSessions: number;
    importers: Array<{
      id: string;
      enabled: boolean;
      indexedSessions: number;
    }>;
  };
  warnings: string[];
};

export type StatusOptions = {
  cwd: string;
  logger: Logger;
};

export const runStatus = async (
  options: StatusOptions,
): Promise<StatusReport | undefined> => {
  const root = path.resolve(options.cwd);

  options.logger.plain("poko status");

  if (!(await pathExists(path.join(root, POKO_DIR, "poko.json")))) {
    options.logger.warn("this project is not initialized. Run `poko init`.");
    return undefined;
  }

  const context = await loadPokoContext(root);
  const detections = await Promise.all(
    ADAPTERS.map(async (adapter) => ({
      adapter,
      detection: await adapter.detect(context.root),
      enabled: context.config.adapters[adapter.id].enabled,
    })),
  );
  const indexedSessions = await loadHistoryIndex(
    context.root,
    context.config.history.defaultStore,
    context.config.project.id,
  );
  const report = await buildStatusReport(context, detections, indexedSessions);

  reportStatusSummary(report, options.logger);

  return report;
};

const buildStatusReport = async (
  context: PokoContext,
  detections: Array<{
    adapter: (typeof ADAPTERS)[number];
    detection: Awaited<ReturnType<(typeof ADAPTERS)[number]["detect"]>>;
    enabled: boolean;
  }>,
  indexedSessions: Awaited<ReturnType<typeof loadHistoryIndex>>,
): Promise<StatusReport> => {
  const snapshot = await buildProjectSnapshot(context, detections);

  return {
    schemaVersion: 1,
    command: "status",
    generatedAt: new Date().toISOString(),
    project: snapshot.project,
    sourceContext: snapshot.sourceContext,
    adapters: snapshot.adapters,
    history: {
      indexedSessions: indexedSessions.length,
      importers: HISTORY_IMPORTERS.map((importer) => ({
        id: importer.id,
        enabled: context.config.history.agents[importer.id],
        indexedSessions: indexedSessions.filter(
          (session) => session.sourceAgent === importer.id,
        ).length,
      })),
    },
    warnings: context.warnings,
  };
};

const reportStatusSummary = (report: StatusReport, logger: Logger): void => {
  const presentSections = Object.values(report.sourceContext.text).filter(
    (state) => state === "present",
  ).length;
  const enabledAdapters = report.adapters.filter(
    (adapter) => adapter.enabled,
  ).length;
  const detectedAdapters = report.adapters.filter(
    (adapter) => adapter.enabled && adapter.detected,
  ).length;

  logger.plain(`  project: ${report.project.id || "(unset)"}`);
  logger.plain(`  root: ${report.project.root}`);
  logger.plain(
    `  source context: ${presentSections} text file(s), ${report.sourceContext.mcp.servers} MCP server(s), ${report.sourceContext.skills} skill(s)`,
  );
  logger.plain(
    `  adapters: ${enabledAdapters} enabled, ${detectedAdapters} detected here`,
  );
  logger.plain(
    `  history index: ${report.history.indexedSessions} stored session(s)`,
  );

  if (report.warnings.length > 0) {
    logger.plain(`  warnings: ${report.warnings.length}`);
  }
};
