import { ADAPTERS, getAdapter } from "../adapters/index.ts";
import type { AgentAdapter, FileOperation } from "../adapters/types.ts";
import {
  type AgentId,
  resolveAgentId,
  supportedAgentList,
} from "../adapters/types.ts";
import { loadPokoContext, type PokoConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { applyWritePlan, type WriteResult } from "../core/writer.ts";
import { formatNativeDetails } from "../history/native/format.ts";
import {
  buildProjectHistorySync,
  type ProjectHistorySyncResult,
} from "../history/project-sync.ts";
import type { RawHistorySession } from "../history/types.ts";

export type SyncOptions = {
  cwd: string;
  agent?: string;
  all?: boolean;
  dryRun?: boolean;
  noHistory?: boolean;
  logger: Logger;
};

export const runSync = async (options: SyncOptions): Promise<WriteResult[]> => {
  const context = await loadPokoContext(options.cwd);

  for (const warning of context.warnings) {
    options.logger.warn(warning);
  }

  const adapters = await selectAdapters(options, context.config);

  if (adapters.length === 0) {
    options.logger.warn("no supported agents detected. Try `poko sync --all`.");
    return [];
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
          logger: options.logger,
        })
      : undefined;
  const operations = dedupeOperations([...adapterOperations]);
  const results = await applyWritePlan(context.root, operations, {
    dryRun: options.dryRun,
  });

  reportWriteResults(results, options.logger, options.dryRun ?? false);
  reportHistorySync(historySync, options.logger, options.dryRun ?? false);

  if (adapters.some((adapter) => adapter.id === "codex")) {
    const codexMcp = operations.some(
      (operation) => operation.path === ".codex/config.toml",
    );

    if (codexMcp) {
      options.logger.warn(
        "Codex may ignore project .codex/config.toml until this repo is trusted in Codex.",
      );
    }
  }

  return results;
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
      `${dryRun ? "would sync" : "synced"} ${nativeTarget.sessions} session(s), ${nativeTarget.messages} message(s) into ${nativeTarget.target} native history.`,
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

const reportWriteResults = (
  results: WriteResult[],
  logger: Logger,
  dryRun: boolean,
): void => {
  for (const result of results) {
    const prefix = result.action.replace("-", " ");
    logger.info(`${prefix}: ${result.path} (${result.label})`);
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

const parseAgentId = (value: string): AgentId => {
  const agent = resolveAgentId(value);

  if (agent) {
    return agent;
  }

  throw new Error(
    `Unknown agent "${value}". Supported agents: ${supportedAgentList()}.`,
  );
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
