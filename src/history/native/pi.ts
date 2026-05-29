import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { resolvePiImportModel, resolvePiSessionDir } from "../pi.ts";
import type { RawHistoryMessage, RawHistorySession } from "../types.ts";
import {
  conversationMessages,
  countConversationMessages,
  countSameAgentSessions,
  dateFrom,
  deterministicHex,
  deterministicPrefixedId,
  messageDate,
  nativeTargetSessions,
  renderJsonl,
  resolveRealProjectRoot,
  sessionCreatedDate,
  sessionUpdatedDate,
  timestampMs,
  truncate,
  writeAtomic,
} from "./common.ts";
import type {
  NativeHistorySyncer,
  NativeHistorySyncOptions,
  NativeHistorySyncResult,
} from "./types.ts";

export const piNativeSyncer: NativeHistorySyncer = {
  id: "pi",
  sync: syncPiNativeHistory,
};

export async function syncPiNativeHistory(
  options: NativeHistorySyncOptions,
): Promise<NativeHistorySyncResult> {
  const projectRoot = await resolveRealProjectRoot(options.root);
  const sessionDir = await resolvePiSessionDir(projectRoot);
  const sessions = nativeTargetSessions(options.sessions, "pi");
  const messageCount = countConversationMessages(sessions);

  if (options.dryRun) {
    return {
      target: "pi",
      location: sessionDir,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: true,
      skipped: false,
      details: {
        sessionFilesWritten: sessions.length,
        sessionsSkippedFromSameAgent: countSameAgentSessions(
          options.sessions,
          "pi",
        ),
      },
    };
  }

  const fallbackDate = dateFrom(options.config.project.createdAt, new Date());
  const importModel = await resolvePiImportModel(projectRoot);
  const desiredSessionIds = new Set<string>();
  let sessionFilesWritten = 0;

  for (const session of sessions) {
    const sessionId = piSessionId(session);
    const created = sessionCreatedDate(session, fallbackDate);
    desiredSessionIds.add(sessionId);
    await writeAtomic(
      path.join(sessionDir, `${piFileTimestamp(created)}_${sessionId}.jsonl`),
      renderPiSession(
        session,
        sessionId,
        projectRoot,
        fallbackDate,
        importModel,
      ),
    );
    sessionFilesWritten += 1;
  }

  const staleSessionFilesRemoved = await cleanupStalePokoPiImports(
    sessionDir,
    projectRoot,
    desiredSessionIds,
  );

  return {
    target: "pi",
    location: sessionDir,
    sessions: sessions.length,
    messages: messageCount,
    dryRun: false,
    skipped: false,
    details: {
      sessionFilesWritten,
      staleSessionFilesRemoved,
      sessionsSkippedFromSameAgent: countSameAgentSessions(
        options.sessions,
        "pi",
      ),
    },
  };
}

const renderPiSession = (
  session: RawHistorySession,
  sessionId: string,
  projectRoot: string,
  fallbackDate: Date,
  importModel: { provider: string; model: string },
): string => {
  const created = sessionCreatedDate(session, fallbackDate);
  const updated = sessionUpdatedDate(session, created);
  const createdIso = created.toISOString();
  const markerId = piEntryId(
    `poko:pi:marker:${session.sourceAgent}:${session.id}`,
  );
  const titleId = piEntryId(
    `poko:pi:title:${session.sourceAgent}:${session.id}`,
  );
  const rows: unknown[] = [
    {
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: createdIso,
      cwd: projectRoot,
    },
    {
      type: "custom",
      id: markerId,
      parentId: null,
      timestamp: createdIso,
      customType: "poko.import",
      data: {
        originator: "poko",
        sourceAgent: session.sourceAgent,
        sourceSessionId: session.id,
        projectId: session.projectId,
        projectRoot,
      },
    },
    {
      type: "session_info",
      id: titleId,
      parentId: markerId,
      timestamp: updated.toISOString(),
      name: truncate(session.title || "Conversation", 80),
    },
  ];
  let parentId = titleId;

  for (const [index, message] of conversationMessages(session).entries()) {
    const entryId = piEntryId(
      `poko:pi:message:${session.sourceAgent}:${session.id}:${message.id ?? index}:${message.role}`,
    );
    const date = messageDate(message, created);
    rows.push({
      type: "message",
      id: entryId,
      parentId,
      timestamp: date.toISOString(),
      message: renderPiMessage(message, date, importModel),
    });
    parentId = entryId;
  }

  return renderJsonl(rows);
};

const renderPiMessage = (
  message: RawHistoryMessage,
  timestamp: Date,
  importModel: { provider: string; model: string },
): unknown => {
  if (message.role === "user") {
    return {
      role: "user",
      content: message.text,
      timestamp: timestampMs(timestamp),
    };
  }

  return {
    role: "assistant",
    content: [{ type: "text", text: message.text }],
    api: "poko",
    provider: importModel.provider,
    model: importModel.model,
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: timestampMs(timestamp),
  };
};

const cleanupStalePokoPiImports = async (
  sessionDir: string,
  projectRoot: string,
  desiredSessionIds: Set<string>,
): Promise<number> => {
  const entries = await readdir(sessionDir, { withFileTypes: true }).catch(
    () => [],
  );
  let removed = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const filePath = path.join(sessionDir, entry.name);
    const importInfo = await readPokoPiImportInfo(filePath);

    if (!importInfo || importInfo.projectRoot !== projectRoot) {
      continue;
    }

    if (desiredSessionIds.has(importInfo.sessionId)) {
      continue;
    }

    await rm(filePath, { force: true });
    removed += 1;
  }

  return removed;
};

const readPokoPiImportInfo = async (
  filePath: string,
): Promise<{ sessionId: string; projectRoot: string } | undefined> => {
  try {
    const rows = (await readFile(filePath, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
    const header = rows.find(isPiSessionHeader);
    const marker = rows.find(isPokoPiImportRow);

    if (!header || !marker) {
      return undefined;
    }

    return {
      sessionId: header.id,
      projectRoot: marker.data.projectRoot,
    };
  } catch {
    return undefined;
  }
};

const isPiSessionHeader = (
  row: unknown,
): row is { type: "session"; id: string } =>
  isRecord(row) && row.type === "session" && typeof row.id === "string";

const isPokoPiImportRow = (
  row: unknown,
): row is {
  type: "custom";
  customType: "poko.import";
  data: { originator: "poko"; projectRoot: string };
} =>
  isRecord(row) &&
  row.type === "custom" &&
  row.customType === "poko.import" &&
  isRecord(row.data) &&
  row.data.originator === "poko" &&
  typeof row.data.projectRoot === "string";

const piSessionId = (session: RawHistorySession): string =>
  deterministicPrefixedId(
    "ses",
    `poko:pi:session:${session.sourceAgent}:${session.id}`,
  );

const piEntryId = (value: string): string => deterministicHex(value, 8);

const piFileTimestamp = (date: Date): string =>
  date.toISOString().replace(/[:.]/g, "-");

const emptyUsage = (): Record<string, unknown> => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
