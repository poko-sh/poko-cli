import { readFile } from "node:fs/promises";
import { ADAPTERS } from "../adapters/index.ts";
import type { AgentId } from "../adapters/types.ts";
import {
  parseAgentId,
  parseAgentList,
  parseStore,
} from "../core/agent-parse.ts";
import { loadPokoContext } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import {
  NATIVE_HISTORY_TARGET_IDS,
  syncNativeHistoryTargets,
} from "../history/native/index.ts";
import { writeHistorySessions } from "../history/storage.ts";
import {
  buildHistoryCompatibilityReport,
  collectHistorySyncWarnings,
} from "../history/sync-capabilities.ts";
import {
  type HistoryAgent,
  type HistoryRole,
  type RawHistoryMessage,
  type RawHistorySession,
  resolveHistoryAgent,
} from "../history/types.ts";
import type { SyncReport } from "./sync.ts";

export type RestoreOptions = {
  cwd: string;
  file?: string;
  agent?: string;
  targets?: string;
  all?: boolean;
  dryRun?: boolean;
  store?: string;
  quiet?: boolean;
  logger: Logger;
};

type RestorePayload =
  | RawHistorySession[]
  | {
      sessions?: RawHistorySession[];
      session?: RawHistorySession;
    };

export const runRestore = async (
  options: RestoreOptions,
): Promise<SyncReport> => runRestoreReport(options);

export const runRestoreReport = async (
  options: RestoreOptions,
): Promise<SyncReport> => {
  if (!options.file) {
    throw new Error("Restore requires --file <path>.");
  }

  const context = await loadPokoContext(options.cwd);
  const store = parseStore(
    options.store ?? context.config.history.defaultStore,
  );
  const sessions = normalizeSessions(
    await loadRestoreSessions(options.file),
    context.root,
    context.config.project.id,
  );
  const targetAgents = selectTargetAgents(options, context.config.adapters);

  if (sessions.length > 0 && targetAgents.length === 0) {
    throw new Error(
      "Restore requires native targets. Pass --targets claude,codex or --all to import sessions into agent history.",
    );
  }

  if (!options.dryRun && sessions.length > 0) {
    await writeHistorySessions(
      context.root,
      store,
      sessions,
      context.config.project.id,
    );
  }

  const nativeTargets =
    sessions.length > 0 && targetAgents.length > 0
      ? await syncNativeHistoryTargets({
          root: context.root,
          config: context.config,
          targetAgents,
          sessions,
          dryRun: options.dryRun,
          logger: options.quiet ? undefined : options.logger,
        })
      : [];

  const historyWarnings = collectHistorySyncWarnings({
    targetAgents,
    sessions,
  });

  if (!options.quiet) {
    options.logger.info(
      `${options.dryRun ? "would restore" : "restored"} ${sessions.length} cloud session(s) into ${store} history.`,
    );
    for (const target of nativeTargets) {
      options.logger.info(
        `${options.dryRun ? "would sync" : "synced"} ${target.sessions} session(s), ${target.messages} message(s) into ${target.target}.`,
      );
    }
    for (const warning of historyWarnings) {
      options.logger.warn(warning);
    }
  }

  return {
    schemaVersion: 1,
    command: "restore" as SyncReport["command"],
    mode: "project",
    generatedAt: new Date().toISOString(),
    root: context.root,
    dryRun: Boolean(options.dryRun),
    noHistory: false,
    agents: targetAgents,
    files: [],
    changedFiles: 0,
    history: {
      enabled: true,
      sessions: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        sourceAgent: session.sourceAgent,
        messages: session.messages.length,
        updatedAt: session.updatedAt,
        sourcePath: session.sourcePath,
        projectRoot: session.projectRoot,
      })),
      skippedOlderSessions: 0,
      nativeTargets: nativeTargets.map((target) => ({ ...target })),
    },
    historyCompatibility: buildHistoryCompatibilityReport(),
    warnings: [...context.warnings, ...historyWarnings],
  };
};

const loadRestoreSessions = async (
  filePath: string,
): Promise<RawHistorySession[]> => {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as RestorePayload;

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed.sessions)) {
    return parsed.sessions;
  }

  if (parsed.session) {
    return [parsed.session];
  }

  throw new Error("Restore file must contain a session or sessions array.");
};

const normalizeSessions = (
  sessions: RawHistorySession[],
  projectRoot: string,
  projectId: string,
): RawHistorySession[] =>
  sessions.map((session) => ({
    schemaVersion: 1,
    id: requireString(session.id, "session id"),
    projectId,
    sourceAgent: parseHistoryAgent(session.sourceAgent),
    title: requireString(session.title, "session title"),
    projectRoot,
    createdAt: optionalString(session.createdAt),
    updatedAt: optionalString(session.updatedAt),
    sourcePath: optionalString(session.sourcePath),
    messages: parseMessages(session.messages),
    rawEvents: Array.isArray(session.rawEvents) ? session.rawEvents : undefined,
  }));

const parseMessages = (messages: RawHistoryMessage[]): RawHistoryMessage[] => {
  if (!Array.isArray(messages)) {
    throw new Error("Restore session messages must be an array.");
  }

  return messages.map((message) => ({
    id: optionalString(message.id),
    role: parseRole(message.role),
    text: requireString(message.text, "message text"),
    timestamp: optionalString(message.timestamp),
    raw: message.raw,
  }));
};

const parseRole = (role: string): HistoryRole => {
  if (
    role === "user" ||
    role === "assistant" ||
    role === "system" ||
    role === "tool" ||
    role === "unknown"
  ) {
    return role;
  }

  return "unknown";
};

const parseHistoryAgent = (value: string): HistoryAgent => {
  const agent = resolveHistoryAgent(value);

  if (!agent) {
    throw new Error(`Unsupported source agent in restore file: ${value}.`);
  }

  return agent;
};

const selectTargetAgents = (
  options: RestoreOptions,
  adapters: Record<AgentId, { enabled: boolean }>,
): AgentId[] => {
  if (options.agent) {
    const agent = parseAgentId(options.agent);
    return isNativeHistoryTarget(agent) ? [agent] : [];
  }

  if (options.targets) {
    return parseAgentList(options.targets).filter(isNativeHistoryTarget);
  }

  if (options.all) {
    return ADAPTERS.filter((adapter) => adapters[adapter.id].enabled)
      .map((adapter) => adapter.id)
      .filter(isNativeHistoryTarget);
  }

  return [];
};

const isNativeHistoryTarget = (agent: AgentId): boolean =>
  (NATIVE_HISTORY_TARGET_IDS as AgentId[]).includes(agent);

const requireString = (value: unknown, label: string): string => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new Error(`Restore file is missing ${label}.`);
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
