import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { AgentId } from "../adapters/types.ts";
import {
  BunFileMissingError,
  createDefaultPokoConfig,
  loadPokoConfig,
  type PokoConfig,
} from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { HISTORY_IMPORTERS } from "./importers/index.ts";
import { collapseEquivalentSessions } from "./lineage.ts";
import { countConversationMessages } from "./native/common.ts";
import {
  NATIVE_HISTORY_TARGET_IDS,
  type NativeHistorySyncResult,
  syncNativeHistoryTargets,
} from "./native/index.ts";
import type {
  HistoryAgent,
  HistoryImporter,
  RawHistorySession,
} from "./types.ts";

export type GlobalNativeHistorySyncResult = NativeHistorySyncResult & {
  projectRoot: string;
};

export type GlobalHistorySyncResult = {
  sessions: RawHistorySession[];
  projects: Array<{
    root: string;
    sessions: number;
    messages: number;
    sourceAgents: HistoryAgent[];
  }>;
  capturedAgents: Array<{
    id: HistoryAgent;
    displayName: string;
    supported: boolean;
    capturedSessions: number;
    capturedMessages: number;
    reason?: string;
  }>;
  nativeTargets: GlobalNativeHistorySyncResult[];
  warnings: string[];
};

export const buildGlobalHistorySync = async (options: {
  cwd: string;
  config?: PokoConfig;
  targetAgents: AgentId[];
  dryRun?: boolean;
  logger?: Pick<Logger, "info" | "warn">;
}): Promise<GlobalHistorySyncResult> => {
  const baseConfig = options.config ?? createDefaultPokoConfig();
  const warnings: string[] = [];
  const capturedAgents: GlobalHistorySyncResult["capturedAgents"] = [];
  const sessions = collapseEquivalentSessions(
    dedupeSessions(
      (
        await Promise.all(
          HISTORY_IMPORTERS.map((importer) =>
            captureImporterSessions(importer, baseConfig, warnings),
          ),
        )
      ).flatMap((result) => {
        capturedAgents.push(result.agent);
        return result.sessions;
      }),
    ),
  ).sort(compareSessions);
  const sessionsByProject = groupSessionsByProject(sessions);
  const nativeTargets: GlobalNativeHistorySyncResult[] = [];

  for (const [projectRoot, projectSessions] of sessionsByProject) {
    const projectConfig = await resolveGlobalProjectConfig({
      projectRoot,
      baseConfig,
      sessions: projectSessions,
      warnings,
    });
    const targetResults = await syncNativeHistoryTargets({
      root: projectRoot,
      config: projectConfig,
      targetAgents: nativeTargetAgents(options.targetAgents),
      sessions: projectSessions,
      dryRun: options.dryRun,
      logger: options.logger,
      scratchRoot: globalScratchRoot(projectRoot),
    });

    nativeTargets.push(
      ...targetResults.map((target) => ({
        ...target,
        projectRoot,
      })),
    );
  }

  return {
    sessions,
    projects: [...sessionsByProject.entries()]
      .map(([root, projectSessions]) => ({
        root,
        sessions: projectSessions.length,
        messages: countConversationMessages(projectSessions),
        sourceAgents: unique(
          projectSessions.map((session) => session.sourceAgent),
        ).sort(),
      }))
      .sort(
        (left, right) =>
          right.sessions - left.sessions || left.root.localeCompare(right.root),
      ),
    capturedAgents,
    nativeTargets,
    warnings,
  };
};

const captureImporterSessions = async (
  importer: HistoryImporter,
  config: PokoConfig,
  warnings: string[],
): Promise<{
  agent: GlobalHistorySyncResult["capturedAgents"][number];
  sessions: RawHistorySession[];
}> => {
  if (!config.history.agents[importer.id]) {
    return {
      agent: {
        id: importer.id,
        displayName: importer.displayName,
        supported: Boolean(importer.captureAll),
        capturedSessions: 0,
        capturedMessages: 0,
        reason: "disabled in history config",
      },
      sessions: [],
    };
  }

  if (!importer.captureAll) {
    return {
      agent: {
        id: importer.id,
        displayName: importer.displayName,
        supported: false,
        capturedSessions: 0,
        capturedMessages: 0,
        reason: "global capture is not implemented for this agent",
      },
      sessions: [],
    };
  }

  try {
    const sessions = (await importer.captureAll()).filter((session) =>
      Boolean(session.projectRoot),
    );
    return {
      agent: {
        id: importer.id,
        displayName: importer.displayName,
        supported: true,
        capturedSessions: sessions.length,
        capturedMessages: countConversationMessages(sessions),
      },
      sessions,
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : `unknown error: ${String(error)}`;
    warnings.push(`${importer.displayName} global capture skipped: ${reason}`);
    return {
      agent: {
        id: importer.id,
        displayName: importer.displayName,
        supported: true,
        capturedSessions: 0,
        capturedMessages: 0,
        reason,
      },
      sessions: [],
    };
  }
};

const resolveGlobalProjectConfig = async (options: {
  projectRoot: string;
  baseConfig: PokoConfig;
  sessions: RawHistorySession[];
  warnings: string[];
}): Promise<PokoConfig> => {
  try {
    const projectConfig = await loadPokoConfig(options.projectRoot);
    return withProjectIdentity(
      projectConfig,
      options.projectRoot,
      options.sessions,
    );
  } catch (error) {
    if (!(error instanceof BunFileMissingError)) {
      options.warnings.push(
        `${options.projectRoot} .poko config could not be loaded for global sync; using default history settings.`,
      );
    }

    return withProjectIdentity(
      options.baseConfig,
      options.projectRoot,
      options.sessions,
    );
  }
};

const withProjectIdentity = (
  config: PokoConfig,
  projectRoot: string,
  sessions: RawHistorySession[],
): PokoConfig => ({
  ...config,
  project: {
    ...config.project,
    id: config.project.id || `global-${projectKey(projectRoot)}`,
    createdAt:
      config.project.createdAt ||
      earliestSessionTimestamp(sessions) ||
      new Date(0).toISOString(),
  },
});

const groupSessionsByProject = (
  sessions: RawHistorySession[],
): Map<string, RawHistorySession[]> => {
  const groups = new Map<string, RawHistorySession[]>();

  for (const session of sessions) {
    const root = path.resolve(session.projectRoot);
    const projectSessions = groups.get(root) ?? [];
    projectSessions.push({ ...session, projectRoot: root });
    groups.set(root, projectSessions);
  }

  return groups;
};

const dedupeSessions = (sessions: RawHistorySession[]): RawHistorySession[] => {
  const seen = new Set<string>();
  const uniqueSessions: RawHistorySession[] = [];

  for (const session of sessions) {
    const key = `${path.resolve(session.projectRoot)}:${session.sourceAgent}:${session.id}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueSessions.push(session);
  }

  return uniqueSessions;
};

const nativeTargetAgents = (agents: AgentId[]): AgentId[] => {
  const nativeTargets = new Set<AgentId>(NATIVE_HISTORY_TARGET_IDS);
  return agents.filter((agent) => nativeTargets.has(agent));
};

const globalScratchRoot = (projectRoot: string): string =>
  path.join(os.homedir(), ".poko", "global-sync", projectKey(projectRoot));

const projectKey = (projectRoot: string): string =>
  createHash("sha256")
    .update(path.resolve(projectRoot))
    .digest("hex")
    .slice(0, 16);

const earliestSessionTimestamp = (
  sessions: RawHistorySession[],
): string | undefined =>
  sessions
    .flatMap((session) => [session.createdAt, session.updatedAt])
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort()
    .at(0);

const compareSessions = (
  left: RawHistorySession,
  right: RawHistorySession,
): number =>
  (right.updatedAt ?? right.createdAt ?? "").localeCompare(
    left.updatedAt ?? left.createdAt ?? "",
  );

const unique = <T>(values: T[]): T[] => [...new Set(values)];
