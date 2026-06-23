import path from "node:path";
import { sourceLineageId } from "../lineage.ts";
import type { RawHistoryMessage, RawHistorySession } from "../types.ts";
import { nativeMessageAnnotations } from "./annotations.ts";
import {
  appendJsonLineIfMissing,
  conversationMessages,
  countConversationMessages,
  countSameAgentSessions,
  dateFrom,
  deterministicUuid,
  homePath,
  messageDate,
  nativeTargetSessions,
  renderJsonl,
  resolveRealProjectRoot,
  sessionCreatedDate,
  sessionUpdatedDate,
  truncate,
  writeAtomic,
} from "./common.ts";
import type {
  NativeHistorySyncer,
  NativeHistorySyncOptions,
  NativeHistorySyncResult,
} from "./types.ts";

export const codexNativeSyncer: NativeHistorySyncer = {
  id: "codex",
  sync: syncCodexNativeHistory,
};

export async function syncCodexNativeHistory(
  options: NativeHistorySyncOptions,
): Promise<NativeHistorySyncResult> {
  const codexHome = resolveCodexHome();
  const sessionsRoot = path.join(codexHome, "sessions");
  const sessions = nativeTargetSessions(options.sessions, "codex");
  const messageCount = countConversationMessages(sessions);
  const fallbackDate = dateFrom(options.config.project.createdAt, new Date());

  if (options.dryRun) {
    return {
      target: "codex",
      location: sessionsRoot,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: true,
      skipped: false,
      details: {
        rolloutsWritten: sessions.length,
        titlesIndexed: sessions.length,
        sessionsSkippedFromSameAgent: countSameAgentSessions(
          options.sessions,
          "codex",
        ),
      },
    };
  }

  const projectRoot = await resolveRealProjectRoot(options.root);
  let rolloutsWritten = 0;
  let titlesIndexed = 0;

  for (const session of sessions) {
    const created = sessionCreatedDate(session, fallbackDate);
    const sessionId = codexSessionId(session);
    const rolloutPath = codexRolloutPath(sessionsRoot, created, sessionId);

    await writeAtomic(
      rolloutPath,
      renderCodexRollout(session, sessionId, projectRoot, created),
    );
    rolloutsWritten += 1;

    const indexed = await appendJsonLineIfMissing(
      path.join(codexHome, "session_index.jsonl"),
      {
        id: sessionId,
        thread_name: truncate(session.title || "Poko import", 80),
        updated_at: sessionUpdatedDate(session, created).toISOString(),
      },
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "id" in row &&
        row.id === sessionId,
    );

    if (indexed) {
      titlesIndexed += 1;
    }
  }

  return {
    target: "codex",
    location: sessionsRoot,
    sessions: sessions.length,
    messages: messageCount,
    dryRun: false,
    skipped: false,
    details: {
      rolloutsWritten,
      titlesIndexed,
      sessionsSkippedFromSameAgent: countSameAgentSessions(
        options.sessions,
        "codex",
      ),
    },
  };
}

const resolveCodexHome = (): string =>
  process.env.CODEX_HOME ?? homePath(".codex");

const codexSessionId = (session: RawHistorySession): string =>
  deterministicUuid(`poko:codex:session:${session.sourceAgent}:${session.id}`);

const codexRolloutPath = (
  sessionsRoot: string,
  created: Date,
  sessionId: string,
): string =>
  path.join(
    sessionsRoot,
    String(created.getFullYear()),
    pad(created.getMonth() + 1),
    pad(created.getDate()),
    `rollout-${rolloutTimestamp(created)}-${sessionId}.jsonl`,
  );

const renderCodexRollout = (
  session: RawHistorySession,
  sessionId: string,
  projectRoot: string,
  created: Date,
): string => {
  const rows: unknown[] = [
    {
      timestamp: created.toISOString(),
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: created.toISOString(),
        cwd: projectRoot,
        originator: "poko",
        cli_version: "poko-import",
        source_agent: session.sourceAgent,
        source_session_id: session.id,
        lineage_id: sourceLineageId(session),
        project_id: session.projectId,
        source: "cli",
        thread_source: "user",
        model_provider: "openai",
        base_instructions: null,
        memory_mode: "disabled",
      },
    },
  ];

  let currentTurnId: string | undefined;
  let currentTurnStartedAt: Date | undefined;

  for (const [index, message] of conversationMessages(session).entries()) {
    const timestamp = messageDate(message, created).toISOString();
    if (message.role === "user") {
      currentTurnId = deterministicUuid(
        `poko:codex:turn:${session.sourceAgent}:${session.id}:${index}`,
      );
      currentTurnStartedAt = messageDate(message, created);
      rows.push(
        renderCodexTurnStartedEvent(currentTurnId, currentTurnStartedAt),
      );
    }

    rows.push(...renderCodexResponseItems(message, timestamp));
    rows.push(
      ...renderCodexTranscriptEvents(
        message,
        timestamp,
        projectRoot,
        currentTurnId,
      ),
    );

    if (message.role === "assistant" && currentTurnId) {
      rows.push(
        renderCodexTurnCompleteEvent(
          currentTurnId,
          message,
          timestamp,
          currentTurnStartedAt,
        ),
      );
      currentTurnId = undefined;
      currentTurnStartedAt = undefined;
    }
  }

  return renderJsonl(rows);
};

const renderCodexResponseItems = (
  message: RawHistoryMessage,
  timestamp: string,
): unknown[] => {
  const annotations = nativeMessageAnnotations(message);

  if (message.role !== "assistant") {
    return [
      {
        timestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: message.role,
          content: [
            {
              type: "input_text",
              text: message.text,
            },
          ],
        },
      },
    ];
  }

  const rows: unknown[] = [];

  if (annotations.thinkingText) {
    rows.push({
      timestamp,
      type: "response_item",
      payload: {
        type: "reasoning",
        summary: [{ type: "summary_text", text: annotations.thinkingText }],
        content: null,
        encrypted_content: null,
      },
    });
  }

  if (annotations.visibleText) {
    rows.push({
      timestamp,
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: annotations.visibleText,
          },
        ],
      },
    });
  }

  for (const [index, toolUse] of annotations.toolUses.entries()) {
    const callId =
      toolUse.id ??
      deterministicUuid(
        `poko:codex:tool-call:${timestamp}:${toolUse.name}:${index}`,
      );
    rows.push({
      timestamp,
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({
          cmd: codexToolCommand(toolUse.name, toolUse.input),
        }),
        call_id: callId,
      },
    });

    if (annotations.toolResult) {
      rows.push({
        timestamp,
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: callId,
          output: annotations.toolResult,
        },
      });
    }
  }

  if (rows.length === 0) {
    rows.push({
      timestamp,
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: message.text }],
      },
    });
  }

  return rows;
};

const renderCodexTranscriptEvents = (
  message: RawHistoryMessage,
  timestamp: string,
  projectRoot: string,
  turnId: string | undefined,
): unknown[] => {
  if (message.role !== "assistant") {
    return [
      {
        timestamp,
        type: "event_msg",
        payload: {
          type: "user_message",
          message: message.text,
        },
      },
    ];
  }

  const annotations = nativeMessageAnnotations(message);
  const rows: unknown[] = [];

  if (annotations.thinkingText) {
    rows.push({
      timestamp,
      type: "event_msg",
      payload: {
        type: "agent_reasoning",
        text: annotations.thinkingText,
      },
    });
  }

  if (annotations.visibleText) {
    rows.push({
      timestamp,
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: codexTranscriptMessage(annotations),
      },
    });
  }

  for (const [index, toolUse] of annotations.toolUses.entries()) {
    const callId =
      toolUse.id ??
      deterministicUuid(
        `poko:codex:tool-event:${timestamp}:${toolUse.name}:${index}`,
      );
    const command = codexToolCommand(toolUse.name, toolUse.input);
    rows.push({
      timestamp,
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: callId,
        turn_id: turnId ?? "",
        command: ["/bin/zsh", "-lc", command],
        cwd: projectRoot,
        parsed_cmd: [codexParsedCommand(toolUse.name, toolUse.input, command)],
        source: "unified_exec_startup",
        stdout: "",
        stderr: "",
        aggregated_output: annotations.toolResult ?? "",
        exit_code: 0,
        duration: { secs: 0, nanos: 0 },
        formatted_output: "",
        status: "completed",
      },
    });
  }

  if (rows.length === 0) {
    rows.push({
      timestamp,
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: message.text,
      },
    });
  }

  return rows;
};

const renderCodexTurnStartedEvent = (
  turnId: string,
  startedAt: Date,
): unknown => ({
  timestamp: startedAt.toISOString(),
  type: "event_msg",
  payload: {
    type: "turn_started",
    turn_id: turnId,
    started_at: Math.floor(startedAt.getTime() / 1000),
    model_context_window: null,
    collaboration_mode_kind: "default",
  },
});

const renderCodexTurnCompleteEvent = (
  turnId: string,
  message: RawHistoryMessage,
  timestamp: string,
  startedAt?: Date,
): unknown => {
  const completed = new Date(timestamp);
  const annotations = nativeMessageAnnotations(message);
  return {
    timestamp,
    type: "event_msg",
    payload: {
      type: "task_complete",
      turn_id: turnId,
      last_agent_message: annotations.visibleText || message.text,
      completed_at: Math.floor(completed.getTime() / 1000),
      duration_ms: startedAt
        ? Math.max(0, completed.getTime() - startedAt.getTime())
        : null,
      time_to_first_token_ms: null,
    },
  };
};

const codexToolCommand = (
  name: string,
  input: Record<string, unknown> | undefined,
): string => {
  const filePath =
    typeof input?.file_path === "string"
      ? input.file_path
      : typeof input?.path === "string"
        ? input.path
        : undefined;
  if (name.toLowerCase() === "read" && filePath) {
    return `sed -n '1,120p' ${shellQuote(filePath)}`;
  }
  const renderedInput = input ? ` ${JSON.stringify(input)}` : "";
  return `${name}${renderedInput}`;
};

const codexParsedCommand = (
  name: string,
  input: Record<string, unknown> | undefined,
  command: string,
): Record<string, unknown> => {
  const filePath =
    typeof input?.file_path === "string"
      ? input.file_path
      : typeof input?.path === "string"
        ? input.path
        : undefined;
  if (name.toLowerCase() === "read" && filePath) {
    return {
      type: "read",
      cmd: command,
      name: path.basename(filePath.split(":")[0] ?? filePath),
      path: filePath,
    };
  }
  return { type: "unknown", cmd: command };
};

const codexTranscriptMessage = (
  annotations: ReturnType<typeof nativeMessageAnnotations>,
): string => {
  const sections = [annotations.visibleText].filter(Boolean);
  if (annotations.thinkingText) {
    sections.push(`**Reasoning**\n${annotations.thinkingText}`);
  }
  for (const toolUse of annotations.toolUses) {
    const title = `**Tool: ${toolUse.name}**`;
    const input = toolUse.input
      ? `\nInput: \`${JSON.stringify(toolUse.input)}\``
      : "";
    const output = annotations.toolResult
      ? `\nOutput:\n\`\`\`text\n${annotations.toolResult}\n\`\`\``
      : "";
    sections.push(`${title}${input}${output}`);
  }
  return sections.join("\n\n");
};

const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;

const rolloutTimestamp = (date: Date): string =>
  [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(
      date.getSeconds(),
    )}`,
  ].join("T");

const pad = (value: number): string => String(value).padStart(2, "0");
