import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { sourceLineageId } from "../lineage.ts";
import type { RawHistoryMessage, RawHistorySession } from "../types.ts";
import { nativeMessageAnnotations } from "./annotations.ts";
import {
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
  truncate,
  writeAtomic,
} from "./common.ts";
import type {
  NativeHistorySyncer,
  NativeHistorySyncOptions,
  NativeHistorySyncResult,
} from "./types.ts";

export const claudeNativeSyncer: NativeHistorySyncer = {
  id: "claude",
  sync: syncClaudeNativeHistory,
};

export async function syncClaudeNativeHistory(
  options: NativeHistorySyncOptions,
): Promise<NativeHistorySyncResult> {
  const claudeHome = resolveClaudeHome();
  const projectRoot = await resolveRealProjectRoot(options.root);
  const projectDir = path.join(
    claudeHome,
    "projects",
    encodeClaudeProjectPath(projectRoot),
  );
  const sessions = nativeTargetSessions(options.sessions, "claude");
  const messageCount = countConversationMessages(sessions);

  if (options.dryRun) {
    return {
      target: "claude",
      location: projectDir,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: true,
      skipped: false,
      details: {
        sessionFilesWritten: sessions.length,
        sessionsSkippedFromSameAgent: countSameAgentSessions(
          options.sessions,
          "claude",
        ),
      },
    };
  }

  const fallbackDate = dateFrom(options.config.project.createdAt, new Date());
  let sessionFilesWritten = 0;
  const desiredSessionIds = new Set<string>();

  for (const session of sessions) {
    const sessionId = claudeSessionId(session);
    desiredSessionIds.add(sessionId);
    await writeAtomic(
      path.join(projectDir, `${sessionId}.jsonl`),
      renderClaudeSession(session, sessionId, projectRoot, fallbackDate),
    );
    sessionFilesWritten += 1;
  }

  const staleSessionFilesRemoved = await cleanupStalePokoClaudeImports(
    projectDir,
    desiredSessionIds,
  );

  return {
    target: "claude",
    location: projectDir,
    sessions: sessions.length,
    messages: messageCount,
    dryRun: false,
    skipped: false,
    details: {
      sessionFilesWritten,
      staleSessionFilesRemoved,
      sessionsSkippedFromSameAgent: countSameAgentSessions(
        options.sessions,
        "claude",
      ),
    },
  };
}

const resolveClaudeHome = (): string =>
  process.env.CLAUDE_CONFIG_DIR ??
  process.env.CLAUDE_HOME ??
  homePath(".claude");

export const encodeClaudeProjectPath = (projectRoot: string): string =>
  projectRoot.normalize("NFC").replace(/[^a-zA-Z0-9]/g, "-");

const claudeSessionId = (session: RawHistorySession): string =>
  deterministicUuid(`poko:claude:session:${session.sourceAgent}:${session.id}`);

const renderClaudeSession = (
  session: RawHistorySession,
  sessionId: string,
  projectRoot: string,
  fallbackDate: Date,
): string => {
  const created = sessionCreatedDate(session, fallbackDate);
  const rows: unknown[] = [
    {
      type: "custom-title",
      customTitle: truncate(session.title || "Conversation", 80),
      sessionId,
      timestamp: created.toISOString(),
      pokoImport: pokoImportMetadata(session, projectRoot),
    },
  ];
  let parentUuid: string | null = null;

  for (const [index, message] of conversationMessages(session).entries()) {
    const uuid = deterministicUuid(
      `poko:claude:message:${session.sourceAgent}:${session.id}:${message.id ?? index}:${message.role}`,
    );
    const timestamp = messageDate(message, created).toISOString();
    rows.push(
      renderClaudeMessage({
        session,
        sessionId,
        uuid,
        parentUuid,
        message,
        timestamp,
        projectRoot,
      }),
    );
    parentUuid = uuid;

    if (message.role === "assistant") {
      const toolResult = renderClaudeToolResult({
        session,
        sessionId,
        assistantUuid: uuid,
        parentUuid,
        message,
        index,
        timestamp,
        projectRoot,
      });

      if (toolResult) {
        rows.push(toolResult);
        parentUuid = toolResult.uuid;
      }
    }
  }

  const lastUserMessage = [...conversationMessages(session)]
    .reverse()
    .find((message) => message.role === "user");

  if (lastUserMessage) {
    rows.push({
      type: "last-prompt",
      lastPrompt: truncate(lastUserMessage.text.split("\n")[0] ?? "", 160),
      sessionId,
      timestamp: messageDate(lastUserMessage, created).toISOString(),
    });
  }

  return renderJsonl(rows);
};

const renderClaudeMessage = (input: {
  session: RawHistorySession;
  sessionId: string;
  uuid: string;
  parentUuid: string | null;
  message: RawHistoryMessage;
  timestamp: string;
  projectRoot: string;
}): unknown => {
  const common = {
    parentUuid: input.parentUuid,
    isSidechain: false,
    uuid: input.uuid,
    timestamp: input.timestamp,
    userType: "external",
    entrypoint: "cli",
    cwd: input.projectRoot,
    sessionId: input.sessionId,
    version: "poko-import",
    gitBranch: "main",
    pokoImport: pokoImportMetadata(input.session, input.projectRoot),
  };

  if (input.message.role === "user") {
    return {
      ...common,
      type: "user",
      message: {
        role: "user",
        content: input.message.text,
      },
    };
  }

  return {
    ...common,
    type: "assistant",
    message: {
      id: `msg_${input.uuid.replaceAll("-", "")}`,
      type: "message",
      role: "assistant",
      model: "poko-import",
      content: renderClaudeAssistantContent(input.message, input.uuid),
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    requestId: null,
  };
};

const renderClaudeAssistantContent = (
  message: RawHistoryMessage,
  assistantUuid: string,
): unknown[] => {
  const annotations = nativeMessageAnnotations(message);
  const content: unknown[] = [];

  if (annotations.thinkingText) {
    content.push({
      type: "thinking",
      thinking: annotations.thinkingText,
      signature: "",
    });
  }

  if (
    annotations.visibleText ||
    (!annotations.thinkingText && annotations.toolUses.length === 0)
  ) {
    content.push({
      type: "text",
      text: annotations.visibleText || message.text,
    });
  }

  for (const [index, toolUse] of annotations.toolUses.entries()) {
    content.push({
      type: "tool_use",
      id: claudeToolUseId(assistantUuid, toolUse.id, index),
      name: toolUse.name,
      input: toolUse.input,
    });
  }

  return content;
};

const renderClaudeToolResult = (input: {
  session: RawHistorySession;
  sessionId: string;
  assistantUuid: string;
  parentUuid: string | null;
  message: RawHistoryMessage;
  index: number;
  timestamp: string;
  projectRoot: string;
}): (Record<string, unknown> & { uuid: string }) | undefined => {
  const annotations = nativeMessageAnnotations(input.message);
  const firstToolUse = annotations.toolUses[0];

  if (!annotations.toolResult || !firstToolUse) {
    return undefined;
  }

  const uuid = deterministicUuid(
    `poko:claude:tool-result:${input.session.sourceAgent}:${input.session.id}:${input.message.id ?? input.index}`,
  );

  return {
    parentUuid: input.parentUuid,
    isSidechain: false,
    uuid,
    timestamp: input.timestamp,
    userType: "external",
    entrypoint: "cli",
    cwd: input.projectRoot,
    sessionId: input.sessionId,
    version: "poko-import",
    gitBranch: "main",
    pokoImport: pokoImportMetadata(input.session, input.projectRoot),
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: claudeToolUseId(input.assistantUuid, firstToolUse.id, 0),
          content: annotations.toolResult,
        },
      ],
    },
    toolUseResult: annotations.toolResult,
    sourceToolAssistantUUID: input.assistantUuid,
  };
};

const pokoImportMetadata = (
  session: RawHistorySession,
  projectRoot: string,
): Record<string, string | undefined> => ({
  originator: "poko",
  sourceAgent: session.sourceAgent,
  sourceSessionId: session.id,
  lineageId: sourceLineageId(session),
  projectId: session.projectId,
  projectRoot,
});

const claudeToolUseId = (
  assistantUuid: string,
  existingId: string | undefined,
  index: number,
): string =>
  existingId ??
  `toolu_${deterministicUuid(`poko:claude:tool-use:${assistantUuid}:${index}`)
    .replaceAll("-", "")
    .slice(0, 24)}`;

const cleanupStalePokoClaudeImports = async (
  projectDir: string,
  desiredSessionIds: Set<string>,
): Promise<number> => {
  let entries: Array<{ isFile(): boolean; name: string }>;

  try {
    entries = await readdir(projectDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  let removed = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const sessionId = entry.name.replace(/\.jsonl$/, "");

    if (desiredSessionIds.has(sessionId)) {
      continue;
    }

    const filePath = path.join(projectDir, entry.name);

    if (!(await isPokoClaudeImportFile(filePath))) {
      continue;
    }

    await rm(filePath, { force: true });
    removed += 1;
  }

  return removed;
};

const isPokoClaudeImportFile = async (filePath: string): Promise<boolean> => {
  try {
    const rows = (await readFile(filePath, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);

    return rows.some(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "version" in row &&
        row.version === "poko-import",
    );
  } catch {
    return false;
  }
};
