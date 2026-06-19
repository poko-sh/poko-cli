import { ADAPTERS, getAdapter } from "../adapters/index.ts";
import type {
  AgentAdapter,
  AgentId,
  FileOperation,
} from "../adapters/types.ts";
import { parseAgentId, parseAgentList } from "../core/agent-parse.ts";
import {
  BunFileMissingError,
  createDefaultPokoConfig,
  loadPokoConfig,
  loadPokoContext,
  type PokoConfig,
} from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { applyWritePlan, type WriteResult } from "../core/writer.ts";
import {
  buildGlobalHistorySync,
  type GlobalHistorySyncResult,
} from "../history/global-sync.ts";
import { formatNativeDetails } from "../history/native/format.ts";
import { NATIVE_HISTORY_TARGET_IDS } from "../history/native/index.ts";
import {
  buildProjectHistorySync,
  type ProjectHistorySyncResult,
} from "../history/project-sync.ts";
import {
  buildHistoryCompatibilityReport,
  collectHistorySyncWarnings,
  getAgentSyncCapabilities,
  type HistoryCompatibilityReport,
} from "../history/sync-capabilities.ts";
import type { RawHistorySession } from "../history/types.ts";

export type SyncOptions = {
  cwd: string;
  agent?: string;
  targets?: string;
  all?: boolean;
  global?: boolean;
  dryRun?: boolean;
  noHistory?: boolean;
  backup?: boolean;
  diff?: boolean;
  quiet?: boolean;
  logger: Logger;
};

export type SyncReport = {
  schemaVersion: 1;
  command: "sync" | "restore";
  mode: "project" | "global";
  generatedAt: string;
  root: string;
  dryRun: boolean;
  noHistory: boolean;
  agents: string[];
  files: WriteResult[];
  changedFiles: number;
  history?: {
    enabled: boolean;
    sessions: Array<{
      id: string;
      title: string;
      sourceAgent: string;
      messages: number;
      updatedAt?: string;
      sourcePath?: string;
      projectRoot?: string;
    }>;
    skippedOlderSessions: number;
    nativeTargets: Array<{
      target: string;
      projectRoot?: string;
      location: string;
      sessions: number;
      messages: number;
      dryRun: boolean;
      skipped: boolean;
      reason?: string;
      details?: Record<string, number | string | boolean>;
    }>;
    appCloseAgents?: string[];
  };
  global?: {
    projects: Array<{
      root: string;
      sessions: number;
      messages: number;
      sourceAgents: string[];
    }>;
    capturedAgents: Array<{
      id: string;
      displayName: string;
      supported: boolean;
      capturedSessions: number;
      capturedMessages: number;
      reason?: string;
    }>;
  };
  historyCompatibility: HistoryCompatibilityReport;
  warnings: string[];
};

export const runSync = async (options: SyncOptions): Promise<WriteResult[]> => {
  const report = await runSyncReport(options);
  return report.files;
};

export const runSyncReport = async (
  options: SyncOptions,
): Promise<SyncReport> => {
  if (options.global) {
    return runGlobalSyncReport(options);
  }

  const context = await loadPokoContext(options.cwd);

  if (!options.quiet) {
    for (const warning of context.warnings) {
      options.logger.warn(warning);
    }
  }

  const adapters = await selectAdapters(options, context.config);

  if (adapters.length === 0) {
    if (!options.quiet) {
      options.logger.warn(
        "no supported agents detected. Try `poko sync --all`.",
      );
    }

    return {
      schemaVersion: 1,
      command: "sync",
      mode: "project",
      generatedAt: new Date().toISOString(),
      root: context.root,
      dryRun: Boolean(options.dryRun),
      noHistory: Boolean(options.noHistory),
      agents: [],
      files: [],
      changedFiles: 0,
      historyCompatibility: buildHistoryCompatibilityReport(),
      warnings: context.warnings,
    };
  }

  const adapterOperations = adapters.flatMap((adapter) =>
    adapter.render(context, { config: context.config }),
  );
  const historySync =
    context.config.history.syncOnProjectSync && !options.noHistory
      ? await buildProjectHistorySync({
          root: context.root,
          config: context.config,
          targetAgents: adapters.map((adapter) => adapter.id),
          dryRun: options.dryRun,
          logger: options.quiet ? undefined : options.logger,
        })
      : undefined;
  const operations = dedupeOperations([...adapterOperations]);
  const results = await applyWritePlan(context.root, operations, {
    dryRun: options.dryRun,
    backup: options.backup,
    showDiff: options.diff,
  });

  if (!options.quiet) {
    reportWriteResults(results, options.logger, options.dryRun ?? false);
    reportHistorySync(historySync, options.logger, options.dryRun ?? false);
  }

  if (adapters.some((adapter) => adapter.id === "codex")) {
    const codexMcp = operations.some(
      (operation) => operation.path === ".codex/config.toml",
    );

    if (codexMcp) {
      if (!options.quiet) {
        options.logger.warn(
          "Codex may ignore project .codex/config.toml until this repo is trusted in Codex.",
        );
      }
    }
  }

  const historyWarnings =
    historySync && !options.noHistory
      ? [
          ...historySync.warnings,
          ...collectHistorySyncWarnings({
            targetAgents: adapters.map((adapter) => adapter.id),
            sessions: historySync.sessions,
          }),
        ]
      : [];

  if (!options.quiet) {
    for (const warning of historyWarnings) {
      options.logger.warn(warning);
    }
  }

  return {
    schemaVersion: 1,
    command: "sync",
    mode: "project",
    generatedAt: new Date().toISOString(),
    root: context.root,
    dryRun: Boolean(options.dryRun),
    noHistory: Boolean(options.noHistory),
    agents: adapters.map((adapter) => adapter.id),
    files: results,
    changedFiles: results.filter((result) => result.action !== "unchanged")
      .length,
    history: historySync
      ? summarizeHistorySync(historySync)
      : {
          enabled: false,
          sessions: [],
          skippedOlderSessions: 0,
          nativeTargets: [],
        },
    historyCompatibility: buildHistoryCompatibilityReport(),
    warnings: [...context.warnings, ...historyWarnings],
  };
};

const runGlobalSyncReport = async (
  options: SyncOptions,
): Promise<SyncReport> => {
  if (options.noHistory) {
    throw new Error(
      "`poko sync --global` is history-only; remove --no-history.",
    );
  }

  const config = await loadOptionalPokoConfig(options.cwd);
  const targetAgents = selectGlobalTargetAgents(options, config);

  if (targetAgents.length === 0) {
    if (!options.quiet) {
      options.logger.warn("no native history targets are enabled.");
    }

    return {
      schemaVersion: 1,
      command: "sync",
      mode: "global",
      generatedAt: new Date().toISOString(),
      root: options.cwd,
      dryRun: Boolean(options.dryRun),
      noHistory: false,
      agents: [],
      files: [],
      changedFiles: 0,
      history: {
        enabled: true,
        sessions: [],
        skippedOlderSessions: 0,
        nativeTargets: [],
      },
      global: {
        projects: [],
        capturedAgents: [],
      },
      historyCompatibility: buildHistoryCompatibilityReport(),
      warnings: [],
    };
  }

  const globalSync = await buildGlobalHistorySync({
    cwd: options.cwd,
    config,
    targetAgents,
    dryRun: options.dryRun,
    logger: options.quiet ? undefined : options.logger,
  });

  if (!options.quiet) {
    reportGlobalHistorySync(
      globalSync,
      options.logger,
      Boolean(options.dryRun),
    );
  }

  const historyWarnings = collectHistorySyncWarnings({
    targetAgents,
    sessions: globalSync.sessions,
  });

  if (!options.quiet) {
    for (const warning of historyWarnings) {
      options.logger.warn(warning);
    }
  }

  return {
    schemaVersion: 1,
    command: "sync",
    mode: "global",
    generatedAt: new Date().toISOString(),
    root: options.cwd,
    dryRun: Boolean(options.dryRun),
    noHistory: false,
    agents: targetAgents,
    files: [],
    changedFiles: 0,
    history: summarizeGlobalHistorySync(globalSync),
    global: {
      projects: globalSync.projects,
      capturedAgents: globalSync.capturedAgents,
    },
    historyCompatibility: buildHistoryCompatibilityReport(),
    warnings: [...globalSync.warnings, ...historyWarnings],
  };
};

const summarizeHistorySync = (
  result: ProjectHistorySyncResult,
): NonNullable<SyncReport["history"]> => ({
  enabled: true,
  sessions: result.sessions.map((session) => ({
    id: session.id,
    title: session.title,
    sourceAgent: session.sourceAgent,
    messages: session.messages.length,
    updatedAt: session.updatedAt,
    sourcePath: session.sourcePath,
  })),
  skippedOlderSessions: result.skipped.length,
  nativeTargets: result.nativeTargets.map((target) => ({ ...target })),
  appCloseAgents: collectAppCloseAgents(result.nativeTargets),
});

const summarizeGlobalHistorySync = (
  result: GlobalHistorySyncResult,
): NonNullable<SyncReport["history"]> => ({
  enabled: true,
  sessions: result.sessions.map((session) => ({
    id: session.id,
    title: session.title,
    sourceAgent: session.sourceAgent,
    messages: session.messages.length,
    updatedAt: session.updatedAt,
    sourcePath: session.sourcePath,
    projectRoot: session.projectRoot,
  })),
  skippedOlderSessions: 0,
  nativeTargets: result.nativeTargets.map((target) => ({ ...target })),
  appCloseAgents: collectAppCloseAgents(result.nativeTargets),
});

const collectAppCloseAgents = (
  nativeTargets: Array<{
    target: string;
    dryRun: boolean;
    skipped: boolean;
    sessions: number;
  }>,
): string[] => [
  ...new Set(
    nativeTargets
      .filter(
        (target) =>
          !target.dryRun &&
          !target.skipped &&
          target.sessions > 0 &&
          getAgentSyncCapabilities(target.target as AgentId)?.requiresAppClose,
      )
      .map((target) => target.target),
  ),
];

const reportGlobalHistorySync = (
  result: GlobalHistorySyncResult,
  logger: Logger,
  dryRun: boolean,
): void => {
  logger.info(
    `${dryRun ? "would include" : "included"} ${result.sessions.length} global history session(s) across ${result.projects.length} project(s).`,
  );

  for (const project of result.projects) {
    logger.plain(
      [
        `- ${project.root}`,
        `  sessions: ${project.sessions}`,
        `  messages: ${project.messages}`,
        `  sources: ${project.sourceAgents.join(", ")}`,
      ].join("\n"),
    );
  }

  for (const nativeTarget of result.nativeTargets) {
    const projectSuffix = nativeTarget.projectRoot
      ? ` for ${nativeTarget.projectRoot}`
      : "";

    if (nativeTarget.skipped) {
      logger.warn(
        `${nativeTarget.target} native global chat sync skipped${projectSuffix}: ${nativeTarget.reason ?? "unknown reason"}`,
      );
      reportNativeTargetDetails(
        nativeTarget.location,
        nativeTarget.details,
        logger,
      );
      continue;
    }

    logger.info(
      `${dryRun ? "would sync" : "synced"} ${nativeTarget.sessions} session(s), ${nativeTarget.messages} message(s) into ${nativeTarget.target} native history${projectSuffix}.`,
    );
    reportNativeTargetDetails(
      nativeTarget.location,
      nativeTarget.details,
      logger,
    );
  }

  for (const warning of result.warnings) {
    logger.warn(warning);
  }
};

const reportHistorySync = (
  result: ProjectHistorySyncResult | undefined,
  logger: Logger,
  dryRun: boolean,
): void => {
  if (!result) {
    return;
  }

  if (result.sessions.length > 0) {
    logger.info(
      `${dryRun ? "would include" : "included"} ${result.sessions.length} project history session(s).`,
    );

    if (dryRun) {
      reportHistorySessions(result.sessions, logger);
    }
  }

  for (const nativeTarget of result.nativeTargets) {
    if (nativeTarget.skipped) {
      logger.warn(
        `${nativeTarget.target} native chat sync skipped: ${nativeTarget.reason ?? "unknown reason"}`,
      );
      reportNativeTargetDetails(
        nativeTarget.location,
        nativeTarget.details,
        logger,
      );
      continue;
    }

    logger.info(
      `${dryRun ? "would sync" : "synced"} ${nativeTarget.sessions} session(s), ${nativeTarget.messages} message(s) into ${nativeTarget.target} native history${cursorSuccessSuffix(result, nativeTarget)}.`,
    );
    reportNativeTargetDetails(
      nativeTarget.location,
      nativeTarget.details,
      logger,
    );
  }

  if (result.skipped.length > 0) {
    logger.info(
      `skipped ${result.skipped.length} older same-path history session(s) from before this .poko project was initialized.`,
    );
  }
};

const cursorSuccessSuffix = (
  result: ProjectHistorySyncResult,
  nativeTarget: ProjectHistorySyncResult["nativeTargets"][number],
): string => {
  if (nativeTarget.target !== "cursor") {
    return "";
  }

  const hasCrossAgentSessions = result.sessions.some(
    (session) => session.sourceAgent !== "cursor",
  );

  return hasCrossAgentSessions ? " (read-only archive + Continue chat)" : "";
};

const reportHistorySessions = (
  sessions: RawHistorySession[],
  logger: Logger,
): void => {
  for (const session of sessions) {
    logger.plain(
      [
        `- ${session.title}`,
        `  source: ${session.sourceAgent}`,
        `  id: ${session.id}`,
        `  messages: ${session.messages.length}`,
        session.updatedAt ? `  updated: ${session.updatedAt}` : undefined,
        session.sourcePath ? `  path: ${session.sourcePath}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
};

const reportNativeTargetDetails = (
  location: string,
  details: Record<string, number | string | boolean> | undefined,
  logger: Logger,
): void => {
  logger.info(`  location: ${location}`);
  const formatted = formatNativeDetails(details);

  if (formatted) {
    logger.info(`  details: ${formatted}`);
  }
};

const selectAdapters = async (
  options: SyncOptions,
  config: PokoConfig,
): Promise<AgentAdapter[]> => {
  if (options.agent) {
    const agent = parseAgentId(options.agent);
    return [getRequiredAdapter(agent)];
  }

  if (options.targets) {
    return parseAgentList(options.targets).map(getRequiredAdapter);
  }

  const enabledAdapters = ADAPTERS.filter((adapter) =>
    isEnabled(config, adapter.id),
  );

  if (options.all) {
    return enabledAdapters;
  }

  const detections = await Promise.all(
    enabledAdapters.map(async (adapter) => ({
      adapter,
      detection: await adapter.detect(options.cwd),
    })),
  );

  return detections
    .filter(({ detection }) => detection.detected)
    .map(({ adapter }) => adapter);
};

const selectGlobalTargetAgents = (
  options: SyncOptions,
  config: PokoConfig,
): AgentId[] => {
  if (options.agent) {
    const agent = parseAgentId(options.agent);
    return isNativeHistoryTarget(agent) ? [agent] : [];
  }

  if (options.targets) {
    return parseAgentList(options.targets).filter(isNativeHistoryTarget);
  }

  return ADAPTERS.filter((adapter) => isEnabled(config, adapter.id))
    .map((adapter) => adapter.id)
    .filter(isNativeHistoryTarget);
};

const isNativeHistoryTarget = (agent: AgentId): boolean =>
  (NATIVE_HISTORY_TARGET_IDS as AgentId[]).includes(agent);

const loadOptionalPokoConfig = async (root: string): Promise<PokoConfig> => {
  try {
    return await loadPokoConfig(root);
  } catch (error) {
    if (error instanceof BunFileMissingError) {
      return createDefaultPokoConfig();
    }

    throw error;
  }
};

const reportWriteResults = (
  results: WriteResult[],
  logger: Logger,
  dryRun: boolean,
): void => {
  for (const result of results) {
    const prefix = result.action.replace("-", " ");
    logger.info(`${prefix}: ${result.path} (${result.label})`);

    if (result.backupPath) {
      logger.info(`  backup: ${result.backupPath}`);
    }

    if (result.diff) {
      logger.plain(result.diff);
    }
  }

  const changed = results.filter(
    (result) => result.action !== "unchanged",
  ).length;

  if (dryRun) {
    logger.success(`dry run complete: ${changed} pending change(s).`);
    return;
  }

  logger.success(`synced ${changed} change(s).`);
};

const dedupeOperations = (operations: FileOperation[]): FileOperation[] => {
  const seen = new Set<string>();
  const unique: FileOperation[] = [];

  for (const operation of operations) {
    const key = operationIdentity(operation);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(operation);
  }

  return unique;
};

const operationIdentity = (operation: FileOperation): string => {
  switch (operation.type) {
    case "managed-block":
      return JSON.stringify({
        type: operation.type,
        path: operation.path,
        content: operation.content,
        marker: operation.marker,
        commentStyle: operation.commentStyle,
      });
    case "replace":
      return JSON.stringify({
        type: operation.type,
        path: operation.path,
        content: operation.content,
      });
    case "json-merge":
      return JSON.stringify({
        type: operation.type,
        path: operation.path,
        merge: operation.merge,
        arrayUnion: operation.arrayUnion,
      });
  }
};

const getRequiredAdapter = (agent: AgentId): AgentAdapter => {
  const adapter = getAdapter(agent);

  if (!adapter) {
    throw new Error(`No adapter found for "${agent}".`);
  }

  return adapter;
};

const isEnabled = (config: PokoConfig, id: AgentId): boolean =>
  config.adapters[id].enabled;
