import type { AgentId } from "../adapters/types.ts";
import { filterProjectIncarnation, parseStore } from "../core/agent-parse.ts";
import type { PokoConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { HISTORY_IMPORTERS } from "./importers/index.ts";
import { collapseEquivalentSessions } from "./lineage.ts";
import {
  type NativeHistorySyncResult,
  syncNativeHistoryTargets,
} from "./native/index.ts";
import { writeHistorySessions } from "./storage.ts";
import type { RawHistorySession } from "./types.ts";

export type ProjectHistorySyncResult = {
  sessions: RawHistorySession[];
  skipped: RawHistorySession[];
  nativeTargets: NativeHistorySyncResult[];
  warnings: string[];
};

export const buildProjectHistorySync = async (options: {
  root: string;
  config: PokoConfig;
  targetAgents: AgentId[];
  dryRun?: boolean;
  logger?: Pick<Logger, "info" | "warn">;
}): Promise<ProjectHistorySyncResult> => {
  const { sessions: importedSessions, warnings: captureWarnings } =
    await captureEnabledProjectHistory(
      options.root,
      options.config,
      options.logger,
    );
  const { sessions, skipped } = filterProjectIncarnation(
    collapseEquivalentSessions(importedSessions),
    options.config,
  );
  const stampedSessions = stampProjectIdentity(sessions, options.config);

  if (!options.dryRun && stampedSessions.length > 0) {
    await writeHistorySessions(
      options.root,
      parseStore(options.config.history.defaultStore),
      stampedSessions,
      options.config.project.id,
    );
  }

  const nativeTargets =
    stampedSessions.length > 0
      ? await syncNativeTargets({
          root: options.root,
          config: options.config,
          targetAgents: options.targetAgents,
          sessions: stampedSessions,
          dryRun: options.dryRun,
          logger: options.logger,
        })
      : [];

  return {
    sessions: stampedSessions,
    skipped,
    nativeTargets,
    warnings: captureWarnings,
  };
};

const captureEnabledProjectHistory = async (
  root: string,
  config: PokoConfig,
  logger?: Pick<Logger, "info" | "warn">,
): Promise<{ sessions: RawHistorySession[]; warnings: string[] }> => {
  const sessions: RawHistorySession[] = [];
  const warnings: string[] = [];

  for (const importer of HISTORY_IMPORTERS) {
    if (!config.history.agents[importer.id]) {
      continue;
    }

    try {
      sessions.push(...(await importer.capture(root)));
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : `unknown error: ${String(error)}`;
      const warning = `${importer.displayName} capture skipped: ${reason}`;
      warnings.push(warning);
      logger?.warn(warning);
    }
  }

  return {
    sessions: sessions.sort(compareSessions),
    warnings,
  };
};

const stampProjectIdentity = (
  sessions: RawHistorySession[],
  config: PokoConfig,
): RawHistorySession[] =>
  sessions.map((session) => ({
    ...session,
    projectId: config.project.id || session.projectId,
  }));

const syncNativeTargets = async (options: {
  root: string;
  config: PokoConfig;
  targetAgents: AgentId[];
  sessions: RawHistorySession[];
  dryRun?: boolean;
  logger?: Pick<Logger, "info" | "warn">;
}): Promise<NativeHistorySyncResult[]> =>
  syncNativeHistoryTargets({
    root: options.root,
    config: options.config,
    targetAgents: options.targetAgents,
    sessions: options.sessions,
    dryRun: options.dryRun,
    logger: options.logger,
  });

const compareSessions = (
  left: RawHistorySession,
  right: RawHistorySession,
): number =>
  (right.updatedAt ?? right.createdAt ?? "").localeCompare(
    left.updatedAt ?? left.createdAt ?? "",
  );
