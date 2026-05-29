import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  resolveOpenClawAgentSessionsDir,
  resolveOpenClawSessionStorePath,
} from "../openclaw.ts";
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

type OpenClawSessionStore = Record<string, OpenClawSessionEntry>;

type OpenClawSessionEntry = {
  sessionId: string;
  updatedAt: number;
  sessionFile?: string;
  sessionStartedAt?: number;
  usageFamilyKey?: string;
  displayName?: string;
};

type OpenClawImportInfo = {
  sessionId: string;
  projectRoot: string;
  filePath: string;
};

const OPENCLAW_SESSION_VERSION = 3;

export const openClawNativeSyncer: NativeHistorySyncer = {
  id: "openclaw",
  sync: syncOpenClawNativeHistory,
};

export async function syncOpenClawNativeHistory(
  options: NativeHistorySyncOptions,
): Promise<NativeHistorySyncResult> {
  const sessionDir = resolveOpenClawAgentSessionsDir();
  const storePath = resolveOpenClawSessionStorePath();
  const sessions = nativeTargetSessions(options.sessions, "openclaw");
  const messageCount = countConversationMessages(sessions);

  if (options.dryRun) {
    return {
      target: "openclaw",
      location: sessionDir,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: true,
      skipped: false,
      details: {
        sessionFilesWritten: sessions.length,
        sessionStoreEntriesWritten: sessions.length,
        sessionsSkippedFromSameAgent: countSameAgentSessions(
          options.sessions,
          "openclaw",
        ),
      },
    };
  }

  const projectRoot = await resolveRealProjectRoot(options.root);
  const fallbackDate = dateFrom(options.config.project.createdAt, new Date());
  const desiredSessionIds = new Set<string>();
  let sessionFilesWritten = 0;

  for (const session of sessions) {
    const sessionId = openClawSessionId(session);
    const created = sessionCreatedDate(session, fallbackDate);
    desiredSessionIds.add(sessionId);
    await writeAtomic(
      path.join(
        sessionDir,
        `${openClawFileTimestamp(created)}_${sessionId}.jsonl`,
      ),
      renderOpenClawSession(session, sessionId, projectRoot, fallbackDate),
    );
    sessionFilesWritten += 1;
  }

  const store = await readOpenClawSessionStore(storePath);
  const cleanup = await cleanupStalePokoOpenClawImports(
    sessionDir,
    store,
    projectRoot,
    desiredSessionIds,
  );
  let sessionStoreEntriesWritten = 0;

  for (const session of sessions) {
    const sessionId = openClawSessionId(session);
    const created = sessionCreatedDate(session, fallbackDate);
    const updated = sessionUpdatedDate(session, created);
    store[openClawSessionKey(session)] = {
      sessionId,
      updatedAt: timestampMs(updated),
      sessionStartedAt: timestampMs(created),
      sessionFile: `${openClawFileTimestamp(created)}_${sessionId}.jsonl`,
      usageFamilyKey: `poko:${session.projectId ?? projectRoot}:${session.sourceAgent}:${session.id}`,
      displayName: truncate(session.title || "Conversation", 80),
    };
    sessionStoreEntriesWritten += 1;
  }

  await writeAtomic(storePath, JSON.stringify(sortObject(store), null, 2));

  return {
    target: "openclaw",
    location: sessionDir,
    sessions: sessions.length,
    messages: messageCount,
    dryRun: false,
    skipped: false,
    details: {
      sessionFilesWritten,
      sessionStoreEntriesWritten,
      staleSessionFilesRemoved: cleanup.sessionFilesRemoved,
      staleSessionStoreEntriesRemoved: cleanup.sessionStoreEntriesRemoved,
      sessionsSkippedFromSameAgent: countSameAgentSessions(
        options.sessions,
        "openclaw",
      ),
    },
  };
}

const renderOpenClawSession = (
  session: RawHistorySession,
  sessionId: string,
  projectRoot: string,
  fallbackDate: Date,
): string => {
  const created = sessionCreatedDate(session, fallbackDate);
  const updated = sessionUpdatedDate(session, created);
  const createdIso = created.toISOString();
  const markerId = openClawEntryId(
    `poko:openclaw:marker:${session.sourceAgent}:${session.id}`,
  );
  const titleId = openClawEntryId(
    `poko:openclaw:title:${session.sourceAgent}:${session.id}`,
  );
  const rows: unknown[] = [
    {
      type: "session",
      version: OPENCLAW_SESSION_VERSION,
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
    const entryId = openClawEntryId(
      `poko:openclaw:message:${session.sourceAgent}:${session.id}:${message.id ?? index}:${message.role}`,
    );
    const date = messageDate(message, created);
    rows.push({
      type: "message",
      id: entryId,
      parentId,
      timestamp: date.toISOString(),
      message: renderOpenClawMessage(message),
    });
    parentId = entryId;
  }

  return renderJsonl(rows);
};

const renderOpenClawMessage = (
  message: RawHistoryMessage,
): Record<string, unknown> => {
  if (message.role === "user") {
    return {
      role: "user",
      content: message.text,
    };
  }

  return {
    role: "assistant",
    content: [{ type: "text", text: message.text }],
  };
};

const cleanupStalePokoOpenClawImports = async (
  sessionDir: string,
  store: OpenClawSessionStore,
  projectRoot: string,
  desiredSessionIds: Set<string>,
): Promise<{
  sessionFilesRemoved: number;
  sessionStoreEntriesRemoved: number;
}> => {
  const imports = await readOpenClawImportIndex(sessionDir);
  let sessionFilesRemoved = 0;
  let sessionStoreEntriesRemoved = 0;

  for (const importInfo of imports.values()) {
    if (importInfo.projectRoot !== projectRoot) {
      continue;
    }

    if (desiredSessionIds.has(importInfo.sessionId)) {
      continue;
    }

    await rm(importInfo.filePath, { force: true });
    sessionFilesRemoved += 1;
  }

  for (const [key, entry] of Object.entries(store)) {
    const importInfo = imports.get(entry.sessionId);

    if (!importInfo || importInfo.projectRoot !== projectRoot) {
      continue;
    }

    if (desiredSessionIds.has(entry.sessionId)) {
      continue;
    }

    delete store[key];
    sessionStoreEntriesRemoved += 1;
  }

  return { sessionFilesRemoved, sessionStoreEntriesRemoved };
};

const readOpenClawImportIndex = async (
  sessionDir: string,
): Promise<Map<string, OpenClawImportInfo>> => {
  const entries = await readdir(sessionDir, { withFileTypes: true }).catch(
    () => [],
  );
  const imports = new Map<string, OpenClawImportInfo>();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const filePath = path.join(sessionDir, entry.name);
    const importInfo = await readPokoOpenClawImportInfo(filePath);

    if (importInfo) {
      imports.set(importInfo.sessionId, importInfo);
    }
  }

  return imports;
};

const readPokoOpenClawImportInfo = async (
  filePath: string,
): Promise<OpenClawImportInfo | undefined> => {
  try {
    const rows = (await readFile(filePath, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
    const header = rows.find(isOpenClawSessionHeader);
    const marker = rows.find(isPokoOpenClawImportRow);

    if (!header || !marker) {
      return undefined;
    }

    return {
      sessionId: header.id,
      projectRoot: marker.data.projectRoot,
      filePath,
    };
  } catch {
    return undefined;
  }
};

const readOpenClawSessionStore = async (
  storePath: string,
): Promise<OpenClawSessionStore> => {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as unknown;

    if (!isRecord(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, OpenClawSessionEntry] =>
          isOpenClawSessionEntry(entry[1]),
      ),
    );
  } catch {
    return {};
  }
};

const isOpenClawSessionHeader = (
  row: unknown,
): row is { type: "session"; id: string } =>
  isRecord(row) && row.type === "session" && typeof row.id === "string";

const isPokoOpenClawImportRow = (
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

const isOpenClawSessionEntry = (
  value: unknown,
): value is OpenClawSessionEntry =>
  isRecord(value) &&
  typeof value.sessionId === "string" &&
  typeof value.updatedAt === "number";

const openClawSessionId = (session: RawHistorySession): string =>
  deterministicPrefixedId(
    "ses",
    `poko:openclaw:session:${session.sourceAgent}:${session.id}`,
  );

const openClawSessionKey = (session: RawHistorySession): string =>
  `poko:${session.sourceAgent}:${deterministicHex(session.id, 12)}`;

const openClawEntryId = (value: string): string => deterministicHex(value, 16);

const openClawFileTimestamp = (date: Date): string =>
  date.toISOString().replace(/[:.]/g, "-");

const sortObject = <T>(object: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right)),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
