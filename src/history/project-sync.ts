import type { AgentId } from "../adapters/types.ts";
import type { PokoConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { HISTORY_IMPORTERS } from "./importers/index.ts";
import { collapseEquivalentSessions } from "./lineage.ts";
import {
  type NativeHistorySyncResult,
  syncNativeHistoryTargets,
} from "./native/index.ts";
import { writeHistorySessions } from "./storage.ts";
import type { HistoryStore, RawHistorySession } from "./types.ts";

export type ProjectHistorySyncResult = {
  sessions: RawHistorySession[];
  skipped: RawHistorySession[];
  nativeTargets: NativeHistorySyncResult[];
};

export const buildProjectHistorySync = async (options: {
  root: string;
  config: PokoConfig;
  targetAgents: AgentId[];
  dryRun?: boolean;
  logger?: Pick<Logger, "info" | "warn">;
}): Promise<ProjectHistorySyncResult> => {
  const importedSessions = collapseEquivalentSessions(
    await captureEnabledProjectHistory(options.root, options.config),
  );
  const { sessions, skipped } = filterProjectIncarnation(
    importedSessions,
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

  return { sessions: stampedSessions, skipped, nativeTargets };
};

const captureEnabledProjectHistory = async (
  root: string,
  config: PokoConfig,
): Promise<RawHistorySession[]> => {
  const sessions: RawHistorySession[] = [];

  for (const importer of HISTORY_IMPORTERS) {
    if (!config.history.agents[importer.id]) {
      continue;
    }

    sessions.push(...(await importer.capture(root)));
  }

  return sessions.sort(compareSessions);
};

const filterProjectIncarnation = (
  sessions: RawHistorySession[],
  config: PokoConfig,
): { sessions: RawHistorySession[]; skipped: RawHistorySession[] } => {
  if (config.history.includePreviousProjectIncarnations) {
    return { sessions, skipped: [] };
  }

  const projectCreatedAt = Date.parse(config.project.createdAt);

  if (!Number.isFinite(projectCreatedAt)) {
    return { sessions, skipped: [] };
  }

  const current: RawHistorySession[] = [];
  const skipped: RawHistorySession[] = [];

  for (const session of sessions) {
    const timestamp = Date.parse(session.updatedAt ?? session.createdAt ?? "");

    if (Number.isFinite(timestamp) && timestamp < projectCreatedAt) {
      skipped.push(session);
      continue;
    }

    current.push(session);
  }

  return { sessions: current, skipped };
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

const parseStore = (value: string): HistoryStore => {
  if (value === "local" || value === "repo" || value === "both") {
    return value;
  }

  throw new Error('History store must be one of "local", "repo", or "both".');
};
