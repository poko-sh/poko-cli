import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveHermesStateDbPath } from "../hermes.ts";
import type { RawHistoryMessage, RawHistorySession } from "../types.ts";
import {
  conversationMessages,
  countConversationMessages,
  countSameAgentSessions,
  dateFrom,
  deterministicUuid,
  messageDate,
  nativeTargetSessions,
  resolveRealProjectRoot,
  sessionCreatedDate,
  sessionUpdatedDate,
  truncate,
} from "./common.ts";
import type {
  NativeHistorySyncer,
  NativeHistorySyncOptions,
  NativeHistorySyncResult,
} from "./types.ts";

type HermesImportConfig = {
  pokoImport?: {
    originator?: string;
    sourceAgent?: string;
    sourceSessionId?: string;
    projectId?: string;
    projectRoot?: string;
  };
};

export const hermesNativeSyncer: NativeHistorySyncer = {
  id: "hermes",
  sync: syncHermesNativeHistory,
};

export async function syncHermesNativeHistory(
  options: NativeHistorySyncOptions,
): Promise<NativeHistorySyncResult> {
  const dbPath = resolveHermesStateDbPath();
  const sessions = nativeTargetSessions(options.sessions, "hermes");
  const messageCount = countConversationMessages(sessions);

  if (options.dryRun) {
    return {
      target: "hermes",
      location: dbPath,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: true,
      skipped: false,
      details: {
        sessionsWritten: sessions.length,
        messagesWritten: messageCount,
        sessionsSkippedFromSameAgent: countSameAgentSessions(
          options.sessions,
          "hermes",
        ),
      },
    };
  }

  await mkdir(path.dirname(dbPath), { recursive: true });

  const database = new Database(dbPath);
  const projectRoot = await resolveRealProjectRoot(options.root);
  const fallbackDate = dateFrom(options.config.project.createdAt, new Date());
  const desiredSessionIds = new Set(
    sessions.map((session) => hermesSessionId(session)),
  );
  let sessionsWritten = 0;
  let messagesWritten = 0;
  let staleSessionsRemoved = 0;

  try {
    database.run("pragma busy_timeout = 5000");
    database.run("pragma foreign_keys = ON");
    ensureHermesSchema(database);

    const writeImport = database.transaction((session: RawHistorySession) => {
      const sessionId = hermesSessionId(session);
      const messages = conversationMessages(session);
      const created = sessionCreatedDate(session, fallbackDate);
      const updated = sessionUpdatedDate(session, created);
      const title = resolveHermesTitle(database, session, sessionId);
      const modelConfig: HermesImportConfig = {
        pokoImport: {
          originator: "poko",
          sourceAgent: session.sourceAgent,
          sourceSessionId: session.id,
          projectId: session.projectId,
          projectRoot,
        },
      };

      database
        .query(
          `insert into sessions (
            id, source, model, model_config, system_prompt, started_at,
            ended_at, end_reason, message_count, tool_call_count,
            input_tokens, output_tokens, cache_read_tokens,
            cache_write_tokens, reasoning_tokens, title, api_call_count
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            source = excluded.source,
            model = excluded.model,
            model_config = excluded.model_config,
            system_prompt = excluded.system_prompt,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            end_reason = excluded.end_reason,
            message_count = excluded.message_count,
            tool_call_count = excluded.tool_call_count,
            input_tokens = excluded.input_tokens,
            output_tokens = excluded.output_tokens,
            cache_read_tokens = excluded.cache_read_tokens,
            cache_write_tokens = excluded.cache_write_tokens,
            reasoning_tokens = excluded.reasoning_tokens,
            title = excluded.title,
            api_call_count = excluded.api_call_count`,
        )
        .run(
          sessionId,
          "poko",
          null,
          JSON.stringify(modelConfig),
          `Poko imported project session for ${projectRoot}`,
          timestampSeconds(created),
          timestampSeconds(updated),
          "imported",
          messages.length,
          0,
          0,
          0,
          0,
          0,
          0,
          title,
          0,
        );
      database
        .query("delete from messages where session_id = ?")
        .run(sessionId);

      for (const [index, message] of messages.entries()) {
        insertHermesMessage(database, sessionId, message, index, created);
      }
    });
    const cleanupImports = database.transaction(() => {
      const rows = database
        .query("select id, model_config from sessions where source = ?")
        .all("poko") as Array<{ id: string; model_config: string | null }>;
      let removed = 0;

      for (const row of rows) {
        const importConfig = parseHermesImportConfig(row.model_config);

        if (importConfig.pokoImport?.projectRoot !== projectRoot) {
          continue;
        }

        if (desiredSessionIds.has(row.id)) {
          continue;
        }

        database.query("delete from messages where session_id = ?").run(row.id);
        database.query("delete from sessions where id = ?").run(row.id);
        removed += 1;
      }

      return removed;
    });

    for (const session of sessions) {
      writeImport(session);
      sessionsWritten += 1;
      messagesWritten += conversationMessages(session).length;
    }

    staleSessionsRemoved = cleanupImports();
  } finally {
    database.close();
  }

  return {
    target: "hermes",
    location: dbPath,
    sessions: sessions.length,
    messages: messageCount,
    dryRun: false,
    skipped: false,
    details: {
      sessionsWritten,
      messagesWritten,
      staleSessionsRemoved,
      sessionsSkippedFromSameAgent: countSameAgentSessions(
        options.sessions,
        "hermes",
      ),
    },
  };
}

const ensureHermesSchema = (database: Database): void => {
  database.run(`
    create table if not exists schema_version (
      version integer not null
    )
  `);
  database.run(`
    create table if not exists sessions (
      id text primary key,
      source text not null,
      user_id text,
      model text,
      model_config text,
      system_prompt text,
      parent_session_id text,
      started_at real not null,
      ended_at real,
      end_reason text,
      message_count integer default 0,
      tool_call_count integer default 0,
      input_tokens integer default 0,
      output_tokens integer default 0,
      cache_read_tokens integer default 0,
      cache_write_tokens integer default 0,
      reasoning_tokens integer default 0,
      billing_provider text,
      billing_base_url text,
      billing_mode text,
      estimated_cost_usd real,
      actual_cost_usd real,
      cost_status text,
      cost_source text,
      pricing_version text,
      title text,
      api_call_count integer default 0,
      handoff_state text,
      handoff_platform text,
      handoff_error text,
      foreign key (parent_session_id) references sessions(id)
    )
  `);
  database.run(`
    create table if not exists messages (
      id integer primary key autoincrement,
      session_id text not null references sessions(id),
      role text not null,
      content text,
      tool_call_id text,
      tool_calls text,
      tool_name text,
      timestamp real not null,
      token_count integer,
      finish_reason text,
      reasoning text,
      reasoning_content text,
      reasoning_details text,
      codex_reasoning_items text,
      codex_message_items text,
      platform_message_id text,
      observed integer default 0
    )
  `);
  ensureHermesColumns(database);
  database.run(`
    create table if not exists state_meta (
      key text primary key,
      value text
    )
  `);
  database.run(
    "create index if not exists idx_sessions_source on sessions(source)",
  );
  database.run(
    "create index if not exists idx_sessions_parent on sessions(parent_session_id)",
  );
  database.run(
    "create index if not exists idx_sessions_started on sessions(started_at desc)",
  );
  database.run(
    "create index if not exists idx_messages_session on messages(session_id, timestamp)",
  );

  const versionRow = database
    .query("select version from schema_version limit 1")
    .get() as { version: number } | null;

  if (!versionRow) {
    database.query("insert into schema_version (version) values (?)").run(13);
  }
};

const ensureHermesColumns = (database: Database): void => {
  const sessionColumns: Record<string, string> = {
    user_id: "text",
    model: "text",
    model_config: "text",
    system_prompt: "text",
    parent_session_id: "text",
    ended_at: "real",
    end_reason: "text",
    message_count: "integer default 0",
    tool_call_count: "integer default 0",
    input_tokens: "integer default 0",
    output_tokens: "integer default 0",
    cache_read_tokens: "integer default 0",
    cache_write_tokens: "integer default 0",
    reasoning_tokens: "integer default 0",
    title: "text",
    api_call_count: "integer default 0",
  };
  const messageColumns: Record<string, string> = {
    tool_call_id: "text",
    tool_calls: "text",
    tool_name: "text",
    token_count: "integer",
    finish_reason: "text",
    reasoning: "text",
    reasoning_content: "text",
    reasoning_details: "text",
    codex_reasoning_items: "text",
    codex_message_items: "text",
    platform_message_id: "text",
    observed: "integer default 0",
  };

  for (const [column, definition] of Object.entries(sessionColumns)) {
    ensureColumn(database, "sessions", column, definition);
  }

  for (const [column, definition] of Object.entries(messageColumns)) {
    ensureColumn(database, "messages", column, definition);
  }
};

const ensureColumn = (
  database: Database,
  tableName: string,
  columnName: string,
  definition: string,
): void => {
  const rows = database
    .query(`pragma table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (rows.some((row) => row.name === columnName)) {
    return;
  }

  database.run(
    `alter table ${tableName} add column ${columnName} ${definition}`,
  );
};

const insertHermesMessage = (
  database: Database,
  sessionId: string,
  message: RawHistoryMessage,
  index: number,
  fallbackDate: Date,
): void => {
  const date = messageDate(message, fallbackDate);

  database
    .query(
      `insert into messages (
        session_id, role, content, timestamp, token_count, finish_reason,
        observed
      ) values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      message.role,
      message.text,
      timestampSeconds(date, index),
      null,
      message.role === "assistant" ? "stop" : null,
      0,
    );
};

const resolveHermesTitle = (
  database: Database,
  session: RawHistorySession,
  sessionId: string,
): string => {
  const base = truncate(session.title || "Conversation", 80);
  const conflicting = database
    .query("select id from sessions where title = ? and id != ? limit 1")
    .get(base, sessionId);

  if (!conflicting) {
    return base;
  }

  return truncate(
    `${base} (${session.sourceAgent}:${session.id.slice(0, 8)})`,
    120,
  );
};

const parseHermesImportConfig = (value: string | null): HermesImportConfig => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as HermesImportConfig;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const hermesSessionId = (session: RawHistorySession): string =>
  deterministicUuid(`poko:hermes:session:${session.sourceAgent}:${session.id}`);

const timestampSeconds = (date: Date, offsetMs = 0): number =>
  Math.max(0, date.getTime() + offsetMs) / 1000;
