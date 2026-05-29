import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { PokoConfig } from "../../core/config.ts";
import { pathExists } from "../../core/config.ts";
import type { RawHistoryMessage, RawHistorySession } from "../types.ts";
import {
  closeAppForNativeSync,
  type NativeAppController,
  type NativeAppLifecycle,
  reopenAppAfterNativeSync,
} from "./app-lifecycle.ts";
import { countSameAgentSessions, nativeTargetSessions } from "./common.ts";
import type {
  NativeHistorySyncer,
  NativeHistorySyncOptions,
  NativeHistorySyncResult,
} from "./types.ts";

type T3CodeProjectRow = {
  project_id: string;
  title: string;
  workspace_root: string;
  default_model_selection_json: string | null;
  created_at?: string;
  updated_at?: string;
};

type T3CodeModelSelection = {
  instanceId: string;
  model: string;
};

type T3CodeProject = {
  projectId: string;
  title: string;
  workspaceRoot: string;
  defaultModelSelection: T3CodeModelSelection;
  createdAt: string;
  updatedAt: string;
  created: boolean;
};

type T3CodeEvent = {
  eventId: string;
  aggregateKind: "project" | "thread";
  streamId: string;
  type:
    | "project.created"
    | "thread.created"
    | "thread.message-sent"
    | "thread.turn-start-requested"
    | "thread.turn-diff-completed";
  occurredAt: string;
  commandId: string;
  causationEventId?: string | null;
  payload: Record<string, unknown>;
};

export type T3CodeAppController = NativeAppController;

type T3CodeNativeHistorySyncOptions = NativeHistorySyncOptions & {
  appController?: T3CodeAppController;
};

export const syncT3CodeNativeHistory = async (
  options: T3CodeNativeHistorySyncOptions,
): Promise<NativeHistorySyncResult> => {
  const dbPath = resolveT3CodeDbPath();

  if (!(await pathExists(dbPath))) {
    return {
      target: "t3code",
      location: dbPath,
      sessions: 0,
      messages: 0,
      dryRun: Boolean(options.dryRun),
      skipped: true,
      reason: "T3 Code state.sqlite was not found.",
    };
  }

  const sessions = nativeTargetSessions(options.sessions, "t3code").filter(
    (session) => session.messages.some(isImportableMessage),
  );
  const messageCount = sessions.reduce(
    (count, session) =>
      count + session.messages.filter(isImportableMessage).length,
    0,
  );

  if (options.dryRun) {
    return {
      target: "t3code",
      location: dbPath,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: true,
      skipped: false,
      details: {
        projectsCreated: 0,
        threadsWritten: sessions.length,
        sessionsSkippedFromSameAgent: countSameAgentSessions(
          options.sessions,
          "t3code",
        ),
      },
    };
  }

  const lifecycle = await closeT3CodeForNativeSync(options);

  if (lifecycle.reason) {
    return {
      target: "t3code",
      location: dbPath,
      sessions: 0,
      messages: 0,
      dryRun: false,
      skipped: true,
      reason: lifecycle.reason,
      details: {
        t3CodeWasRunning: lifecycle.wasRunning,
        t3CodeClosed: lifecycle.closed,
        t3CodeReopened: lifecycle.reopened,
        sessionsSkippedFromSameAgent: countSameAgentSessions(
          options.sessions,
          "t3code",
        ),
      },
    };
  }

  const database = new Database(dbPath);
  let result: NativeHistorySyncResult;

  try {
    database.run("pragma busy_timeout = 5000");

    if (!tableExists(database, "orchestration_events")) {
      result = {
        target: "t3code",
        location: dbPath,
        sessions: 0,
        messages: 0,
        dryRun: false,
        skipped: true,
        reason: "T3 Code orchestration event table was not found.",
        details: {
          t3CodeWasRunning: lifecycle.wasRunning,
          t3CodeClosed: lifecycle.closed,
          t3CodeReopened: lifecycle.reopened,
          sessionsSkippedFromSameAgent: countSameAgentSessions(
            options.sessions,
            "t3code",
          ),
        },
      };
    } else {
      const sync = database.transaction(() => {
        const project = ensureProject(database, options.root, options.config);
        let eventsWritten = project.created ? 1 : 0;

        for (const session of sessions) {
          eventsWritten += writeThreadEvents(database, project, session);
        }

        return eventsWritten;
      });
      const eventsWritten = sync() as number;

      result = {
        target: "t3code",
        location: dbPath,
        sessions: sessions.length,
        messages: messageCount,
        dryRun: false,
        skipped: false,
        details: {
          eventsWritten,
          projectsCreated: 0,
          threadsWritten: sessions.length,
          t3CodeWasRunning: lifecycle.wasRunning,
          t3CodeClosed: lifecycle.closed,
          t3CodeReopened: lifecycle.reopened,
          sessionsSkippedFromSameAgent: countSameAgentSessions(
            options.sessions,
            "t3code",
          ),
        },
      };
    }
  } finally {
    database.close();
    await reopenT3CodeAfterNativeSync(options, lifecycle);
  }

  if (result.details) {
    result.details.t3CodeReopened = lifecycle.reopened;
  }

  return result;
};

export const t3CodeNativeSyncer: NativeHistorySyncer = {
  id: "t3code",
  sync: syncT3CodeNativeHistory,
};

const closeT3CodeForNativeSync = async (
  options: T3CodeNativeHistorySyncOptions,
): Promise<NativeAppLifecycle> =>
  closeAppForNativeSync({
    displayName: "T3 Code",
    appNames: resolveT3CodeAppNames(),
    skipEnvVar: "POKO_T3CODE_SKIP_APP_LIFECYCLE",
    appController: options.appController,
    logger: options.logger,
  });

const reopenT3CodeAfterNativeSync = async (
  options: T3CodeNativeHistorySyncOptions,
  lifecycle: NativeAppLifecycle,
): Promise<void> =>
  reopenAppAfterNativeSync(
    {
      displayName: "T3 Code",
      appNames: resolveT3CodeAppNames(),
      skipEnvVar: "POKO_T3CODE_SKIP_APP_LIFECYCLE",
      appController: options.appController,
      logger: options.logger,
    },
    lifecycle,
  );

const resolveT3CodeAppNames = (): string[] => {
  const names = [
    process.env.POKO_T3CODE_APP_NAME,
    "T3 Code (Alpha)",
    "T3 Code",
  ].filter((value): value is string => Boolean(value));

  return [...new Set(names)];
};

const resolveT3CodeDbPath = (): string =>
  process.env.POKO_T3CODE_DB_PATH ??
  path.join(os.homedir(), ".t3", "userdata", "state.sqlite");

const ensureProject = (
  database: Database,
  root: string,
  config: PokoConfig,
): T3CodeProject => {
  const existing = tableExists(database, "projection_projects")
    ? (database
        .query(
          "select * from projection_projects where workspace_root = ? and deleted_at is null",
        )
        .get(root) as T3CodeProjectRow | undefined)
    : undefined;

  if (existing) {
    const defaultModelSelection = parseModelSelection(
      existing.default_model_selection_json,
    );
    const created = ensureProjectCreatedEvent(database, {
      projectId: existing.project_id,
      title: existing.title,
      workspaceRoot: existing.workspace_root,
      defaultModelSelection,
      createdAt: existing.created_at ?? config.project.createdAt,
      updatedAt: existing.updated_at ?? new Date().toISOString(),
    });

    return {
      projectId: existing.project_id,
      title: existing.title,
      workspaceRoot: existing.workspace_root,
      defaultModelSelection,
      createdAt: existing.created_at ?? config.project.createdAt,
      updatedAt: existing.updated_at ?? new Date().toISOString(),
      created,
    };
  }

  const existingEvent = findProjectCreatedEventByRoot(database, root);

  if (existingEvent) {
    return { ...existingEvent, created: false };
  }

  const now = new Date().toISOString();
  const projectId = validId(config.project.id)
    ? config.project.id
    : deterministicUuid(`poko:t3code:project:${root}`);
  const createdAt = config.project.createdAt || now;
  const defaultModelSelection = defaultT3CodeModelSelection();
  const title = path.basename(root) || "Poko Project";
  const created = ensureProjectCreatedEvent(database, {
    projectId,
    title,
    workspaceRoot: root,
    defaultModelSelection,
    createdAt,
    updatedAt: now,
  });

  return {
    projectId,
    title,
    workspaceRoot: root,
    defaultModelSelection,
    createdAt,
    updatedAt: now,
    created,
  };
};

const writeThreadEvents = (
  database: Database,
  project: T3CodeProject,
  session: RawHistorySession,
): number => {
  const messages = session.messages.filter(isImportableMessage);

  if (messages.length === 0) {
    return 0;
  }

  const threadId = deterministicUuid(
    `poko:t3code:thread:${session.sourceAgent}:${session.id}`,
  );
  const createdAt =
    session.createdAt ?? messages[0]?.timestamp ?? new Date().toISOString();
  const updatedAt =
    session.updatedAt ?? messages.at(-1)?.timestamp ?? createdAt;

  let eventsWritten = appendEvent(database, {
    eventId: deterministicUuid(`poko:t3code:event:thread:${threadId}:created`),
    aggregateKind: "thread",
    streamId: threadId,
    type: "thread.created",
    occurredAt: createdAt,
    commandId: `poko:import:${threadId}:create`,
    payload: {
      threadId,
      projectId: project.projectId,
      title: session.title || "Imported Poko conversation",
      modelSelection: project.defaultModelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: session.projectRoot,
      createdAt,
      updatedAt,
    },
  })
    ? 1
    : 0;

  let pendingTurn:
    | {
        turnId: string;
        turnIndex: number;
        turnStartEventId: string;
      }
    | undefined;
  let turnCount = 0;

  for (const [index, message] of messages.entries()) {
    const timestamp = message.timestamp ?? createdAt;
    const messageId = deterministicUuid(
      `poko:t3code:message:${session.sourceAgent}:${session.id}:${message.id ?? index}:${message.role}`,
    );
    const messageEventId = deterministicUuid(
      `poko:t3code:event:message:${threadId}:${messageId}`,
    );

    if (message.role === "user") {
      const hasAssistantReply = hasAssistantBeforeNextUser(messages, index);
      const nextTurn = hasAssistantReply
        ? {
            turnId: deterministicUuid(`poko:t3code:turn:${threadId}:${index}`),
            turnIndex: turnCount + 1,
            turnStartEventId: deterministicUuid(
              `poko:t3code:event:turn-start:${threadId}:${index}`,
            ),
          }
        : undefined;

      eventsWritten += appendEvent(database, {
        eventId: messageEventId,
        aggregateKind: "thread",
        streamId: threadId,
        type: "thread.message-sent",
        occurredAt: timestamp,
        commandId: `poko:import:${threadId}:message:${index}`,
        payload: {
          threadId,
          messageId,
          role: message.role,
          text: message.text,
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      })
        ? 1
        : 0;

      if (nextTurn) {
        eventsWritten += appendEvent(database, {
          eventId: nextTurn.turnStartEventId,
          aggregateKind: "thread",
          streamId: threadId,
          type: "thread.turn-start-requested",
          occurredAt: timestamp,
          commandId: `poko:import:${threadId}:turn-start:${index}`,
          causationEventId: messageEventId,
          payload: {
            threadId,
            messageId,
            modelSelection: project.defaultModelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: timestamp,
          },
        })
          ? 1
          : 0;
        pendingTurn = nextTurn;
      }
      continue;
    }

    const assistantTurn =
      message.role === "assistant"
        ? (pendingTurn ?? {
            turnId: deterministicUuid(`poko:t3code:turn:${threadId}:${index}`),
            turnIndex: turnCount + 1,
            turnStartEventId: deterministicUuid(
              `poko:t3code:event:turn-start:${threadId}:${index}`,
            ),
          })
        : undefined;

    eventsWritten += appendEvent(database, {
      eventId: messageEventId,
      aggregateKind: "thread",
      streamId: threadId,
      type: "thread.message-sent",
      occurredAt: timestamp,
      commandId: `poko:import:${threadId}:message:${index}`,
      causationEventId:
        message.role === "assistant" ? assistantTurn?.turnStartEventId : null,
      payload: {
        threadId,
        messageId,
        role: message.role,
        text: message.text,
        attachments: [],
        turnId: assistantTurn?.turnId ?? null,
        streaming: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    })
      ? 1
      : 0;

    if (assistantTurn) {
      turnCount = Math.max(turnCount + 1, assistantTurn.turnIndex);
      eventsWritten += appendEvent(database, {
        eventId: deterministicUuid(
          `poko:t3code:event:turn-diff-completed:${threadId}:${assistantTurn.turnId}`,
        ),
        aggregateKind: "thread",
        streamId: threadId,
        type: "thread.turn-diff-completed",
        occurredAt: timestamp,
        commandId: `poko:import:${threadId}:turn-complete:${assistantTurn.turnIndex}`,
        causationEventId: messageEventId,
        payload: {
          threadId,
          turnId: assistantTurn.turnId,
          checkpointTurnCount: assistantTurn.turnIndex,
          checkpointRef: `poko/import/${threadId}/${assistantTurn.turnIndex}`,
          status: "missing",
          files: [],
          assistantMessageId: messageId,
          completedAt: timestamp,
        },
      })
        ? 1
        : 0;
      pendingTurn = undefined;
    }
  }

  return eventsWritten;
};

const ensureProjectCreatedEvent = (
  database: Database,
  project: Omit<T3CodeProject, "created">,
): boolean => {
  const exists = database
    .query(
      "select 1 from orchestration_events where aggregate_kind = 'project' and stream_id = ? and event_type = 'project.created' limit 1",
    )
    .get(project.projectId);

  if (exists) {
    return false;
  }

  return appendEvent(database, {
    eventId: deterministicUuid(
      `poko:t3code:event:project:${project.projectId}:created`,
    ),
    aggregateKind: "project",
    streamId: project.projectId,
    type: "project.created",
    occurredAt: project.createdAt,
    commandId: `poko:import:${project.projectId}:create`,
    payload: {
      projectId: project.projectId,
      title: project.title,
      workspaceRoot: project.workspaceRoot,
      repositoryIdentity: null,
      defaultModelSelection: project.defaultModelSelection,
      scripts: [],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
  });
};

const appendEvent = (database: Database, event: T3CodeEvent): boolean => {
  const existing = database
    .query("select 1 from orchestration_events where event_id = ? limit 1")
    .get(event.eventId);

  if (existing) {
    return false;
  }

  database
    .query(
      [
        "insert into orchestration_events",
        "(",
        "event_id, aggregate_kind, stream_id, stream_version, event_type,",
        "occurred_at, command_id, causation_event_id, correlation_id,",
        "actor_kind, payload_json, metadata_json",
        ") values (",
        "?, ?, ?,",
        "coalesce((",
        "select stream_version + 1 from orchestration_events",
        "where aggregate_kind = ? and stream_id = ?",
        "order by stream_version desc limit 1",
        "), 0),",
        "?, ?, ?, ?, ?, 'client', ?, '{}'",
        ")",
      ].join(" "),
    )
    .run(
      event.eventId,
      event.aggregateKind,
      event.streamId,
      event.aggregateKind,
      event.streamId,
      event.type,
      event.occurredAt,
      event.commandId,
      event.causationEventId ?? null,
      event.commandId,
      JSON.stringify(event.payload),
    );

  return true;
};

const findProjectCreatedEventByRoot = (
  database: Database,
  root: string,
): T3CodeProject | undefined => {
  const rows = database
    .query(
      "select payload_json from orchestration_events where event_type = 'project.created'",
    )
    .all() as { payload_json: string }[];

  for (const row of rows) {
    const payload = safeJsonParse(row.payload_json);

    if (!isRecord(payload) || payload.workspaceRoot !== root) {
      continue;
    }

    return {
      projectId:
        typeof payload.projectId === "string"
          ? payload.projectId
          : deterministicUuid(`poko:t3code:project:${root}`),
      title:
        typeof payload.title === "string"
          ? payload.title
          : path.basename(root) || "Poko Project",
      workspaceRoot: root,
      defaultModelSelection: isModelSelection(payload.defaultModelSelection)
        ? payload.defaultModelSelection
        : defaultT3CodeModelSelection(),
      createdAt:
        typeof payload.createdAt === "string"
          ? payload.createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof payload.updatedAt === "string"
          ? payload.updatedAt
          : new Date().toISOString(),
      created: false,
    };
  }

  return undefined;
};

const hasAssistantBeforeNextUser = (
  messages: RawHistoryMessage[],
  index: number,
): boolean => {
  for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
    const message = messages[nextIndex];

    if (!message) {
      continue;
    }

    if (message.role === "assistant") {
      return true;
    }

    if (message.role === "user") {
      return false;
    }
  }

  return false;
};

const tableExists = (database: Database, tableName: string): boolean =>
  Boolean(
    database
      .query("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(tableName),
  );

const parseModelSelection = (value: string | null): T3CodeModelSelection => {
  const parsed = value ? safeJsonParse(value) : undefined;

  if (isModelSelection(parsed)) {
    return parsed;
  }

  return defaultT3CodeModelSelection();
};

const defaultT3CodeModelSelection = (): T3CodeModelSelection => ({
  instanceId: "codex",
  model: "gpt-5.4",
});

const isModelSelection = (value: unknown): value is T3CodeModelSelection =>
  isRecord(value) &&
  typeof value.instanceId === "string" &&
  typeof value.model === "string";

const safeJsonParse = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isImportableMessage = (message: RawHistoryMessage): boolean =>
  (message.role === "user" ||
    message.role === "assistant" ||
    message.role === "system") &&
  message.text.trim().length > 0;

const deterministicUuid = (value: string): string => {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 32);
  const chars = hash.split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16,
  );
  const hex = chars.join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};

const validId = (value: string): boolean => value.trim().length > 0;
