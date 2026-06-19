import { Database } from "bun:sqlite";
import path from "node:path";
import {
  findCursorWorkspaces,
  listCursorWorkspaces,
  normalizeCursorWorkspacePath,
  resolveCursorGlobalStateDbPath,
  resolveCursorWorkspaceStorageRoot,
} from "../cursor-storage.ts";
import type {
  HistoryImporter,
  RawHistoryMessage,
  RawHistorySession,
} from "../types.ts";
import { isRecord, makeMessage, textFromContent, titleFrom } from "./common.ts";

type CursorComposerHead = {
  composerId: string;
  name?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  workspaceIdentifier?: { id?: string };
  pokoImport?: unknown;
};

export const cursorImporter: HistoryImporter = {
  id: "cursor",
  displayName: "Cursor",
  async capture(projectRoot) {
    const storageRoot = resolveCursorWorkspaceStorageRoot();
    const globalStateDbPath = resolveCursorGlobalStateDbPath();
    const workspaces = await findCursorWorkspaces(storageRoot, projectRoot);
    return captureCursorWorkspaces(workspaces, globalStateDbPath, projectRoot);
  },
  async captureAll() {
    const storageRoot = resolveCursorWorkspaceStorageRoot();
    const globalStateDbPath = resolveCursorGlobalStateDbPath();
    const workspaces = await listCursorWorkspaces(storageRoot);
    return captureCursorWorkspaces(workspaces, globalStateDbPath);
  },
};

const captureCursorWorkspaces = async (
  workspaces: Awaited<ReturnType<typeof listCursorWorkspaces>>,
  globalStateDbPath: string,
  projectRootOverride?: string,
): Promise<RawHistorySession[]> => {
  const sessions: RawHistorySession[] = [];

  for (const workspace of workspaces) {
    try {
      const projectRoot =
        projectRootOverride ??
        normalizeCursorWorkspacePath(workspace.folderUri);

      if (!projectRoot) {
        continue;
      }

      const nativeResult = await readCursorNativeSessions({
        projectRoot,
        workspaceId: workspace.id,
        workspaceDatabasePath: workspace.databasePath,
        globalStateDbPath,
      });

      if (nativeResult.usesGlobalNativeComposerStore) {
        sessions.push(...nativeResult.sessions);
        continue;
      }

      const messages = await readCursorPromptMessages(workspace.databasePath);

      if (messages.length > 0) {
        sessions.push({
          schemaVersion: 1,
          id: `cursor-${path.basename(workspace.directory)}`,
          sourceAgent: "cursor",
          title: titleFrom("Cursor workspace prompts", messages),
          projectRoot,
          createdAt: messages[0]?.timestamp,
          updatedAt: messages.at(-1)?.timestamp,
          sourcePath: workspace.databasePath,
          messages,
          rawEvents: messages.map((message) => message.raw),
        });
      }
    } catch {
      // Cursor may still be reopening and holding its SQLite files.
    }
  }

  return sessions;
};

const readCursorNativeSessions = async (options: {
  projectRoot: string;
  workspaceId: string;
  workspaceDatabasePath: string;
  globalStateDbPath: string;
}): Promise<{
  sessions: RawHistorySession[];
  usesGlobalNativeComposerStore: boolean;
}> => {
  let globalDatabase: Database;

  try {
    globalDatabase = new Database(options.globalStateDbPath, {
      readonly: true,
    });
  } catch {
    return { sessions: [], usesGlobalNativeComposerStore: false };
  }

  let workspaceDatabase: Database;

  try {
    workspaceDatabase = new Database(options.workspaceDatabasePath, {
      readonly: true,
    });
  } catch {
    globalDatabase.close();
    return { sessions: [], usesGlobalNativeComposerStore: false };
  }

  try {
    if (!tableExists(globalDatabase, "cursorDiskKV")) {
      return { sessions: [], usesGlobalNativeComposerStore: false };
    }

    const heads = collectCursorComposerHeads({
      globalDatabase,
      workspaceDatabase,
      workspaceId: options.workspaceId,
    });
    const globalHeads = readHeadsFromItemTable(
      globalDatabase,
      "composer.composerHeaders",
    ).filter((head) => head.workspaceIdentifier?.id === options.workspaceId);
    const usesGlobalNativeComposerStore =
      globalHeads.length > 0 ||
      heads.some(
        (head) =>
          queryCursorDiskValue(
            globalDatabase,
            `composerData:${head.composerId}`,
          ) !== undefined,
      );
    const sessions: RawHistorySession[] = [];

    for (const head of heads) {
      const composerRaw = queryCursorDiskValue(
        globalDatabase,
        `composerData:${head.composerId}`,
      );
      const composer = composerRaw
        ? (JSON.parse(composerRaw) as unknown)
        : undefined;

      if (isCursorPokoTaggedImport(head, composer)) {
        continue;
      }

      const session = readCursorComposerSession({
        database: globalDatabase,
        head,
        projectRoot: options.projectRoot,
        sourcePath: options.globalStateDbPath,
      });

      if (session) {
        sessions.push(session);
      }
    }

    return { sessions, usesGlobalNativeComposerStore };
  } finally {
    workspaceDatabase.close();
    globalDatabase.close();
  }
};

const collectCursorComposerHeads = (options: {
  globalDatabase: Database;
  workspaceDatabase: Database;
  workspaceId: string;
}): CursorComposerHead[] => {
  const heads = new Map<string, CursorComposerHead>();

  for (const head of [
    ...readHeadsFromItemTable(
      options.workspaceDatabase,
      "composer.composerData",
    ),
    ...readHeadsFromItemTable(
      options.globalDatabase,
      "composer.composerHeaders",
    ).filter((head) => head.workspaceIdentifier?.id === options.workspaceId),
  ]) {
    if (typeof head.composerId === "string") {
      heads.set(head.composerId, head);
    }
  }

  return [...heads.values()];
};

const readHeadsFromItemTable = (
  database: Database,
  key: string,
): CursorComposerHead[] => {
  if (!tableExists(database, "ItemTable")) {
    return [];
  }

  const raw = queryValue(database, key);

  if (!raw) {
    return [];
  }

  const data = JSON.parse(raw) as unknown;

  if (!isRecord(data) || !Array.isArray(data.allComposers)) {
    return [];
  }

  return data.allComposers.filter(isCursorComposerHead);
};

const readCursorComposerSession = (options: {
  database: Database;
  head: CursorComposerHead;
  projectRoot: string;
  sourcePath: string;
}): RawHistorySession | undefined => {
  const composerRaw = queryCursorDiskValue(
    options.database,
    `composerData:${options.head.composerId}`,
  );

  if (!composerRaw) {
    return undefined;
  }

  const composer = JSON.parse(composerRaw) as unknown;

  if (!isRecord(composer)) {
    return undefined;
  }

  const headers = Array.isArray(composer.fullConversationHeadersOnly)
    ? composer.fullConversationHeadersOnly
    : [];
  const messages: RawHistoryMessage[] = [];

  for (const [index, header] of headers.entries()) {
    if (!isRecord(header) || typeof header.bubbleId !== "string") {
      continue;
    }

    const bubbleRaw = queryCursorDiskValue(
      options.database,
      `bubbleId:${options.head.composerId}:${header.bubbleId}`,
    );

    if (!bubbleRaw) {
      continue;
    }

    const bubble = JSON.parse(bubbleRaw) as unknown;
    const message = messageFromCursorBubble(bubble, index);

    if (message) {
      messages.push(message);
    }
  }

  if (messages.length === 0) {
    return undefined;
  }

  return {
    schemaVersion: 1,
    id: `cursor-${options.head.composerId}`,
    sourceAgent: "cursor",
    ...pokoImportSessionMetadata(
      cursorPokoImportMetadata(composer) ??
        cursorPokoImportMetadata(options.head),
    ),
    title:
      stringValue(options.head.name) ??
      stringValue(composer.name) ??
      titleFrom("Cursor conversation", messages),
    projectRoot: options.projectRoot,
    createdAt:
      dateFromMilliseconds(options.head.createdAt) ??
      dateFromMilliseconds(numberValue(composer.createdAt)) ??
      messages[0]?.timestamp,
    updatedAt:
      dateFromMilliseconds(options.head.lastUpdatedAt) ??
      dateFromMilliseconds(numberValue(composer.lastUpdatedAt)) ??
      messages.at(-1)?.timestamp,
    sourcePath: options.sourcePath,
    messages,
    rawEvents: [composer, ...messages.map((message) => message.raw)],
  };
};

const readCursorPromptMessages = async (
  databasePath: string,
): Promise<RawHistoryMessage[]> => {
  let database: Database;

  try {
    database = new Database(databasePath, { readonly: true });
  } catch {
    return [];
  }

  try {
    const promptsRaw = queryValue(database, "aiService.prompts");
    const composerRaw = queryValue(database, "composer.composerData");
    return [
      ...messagesFromPrompts(promptsRaw),
      ...messagesFromComposerData(composerRaw),
    ].sort((left, right) =>
      (left.timestamp ?? "").localeCompare(right.timestamp ?? ""),
    );
  } finally {
    database.close();
  }
};

const queryValue = (database: Database, key: string): string | undefined => {
  const row = database
    .query("select value from ItemTable where key = ?")
    .get(key) as { value?: string } | undefined;

  return typeof row?.value === "string" ? row.value : undefined;
};

const queryCursorDiskValue = (
  database: Database,
  key: string,
): string | undefined => {
  const row = database
    .query("select value from cursorDiskKV where key = ?")
    .get(key) as { value?: string } | undefined;

  return typeof row?.value === "string" ? row.value : undefined;
};

const messagesFromPrompts = (raw: string | undefined): RawHistoryMessage[] => {
  if (!raw) {
    return [];
  }

  const prompts = JSON.parse(raw) as unknown;

  if (!Array.isArray(prompts)) {
    return [];
  }

  return prompts.flatMap((prompt, index) => {
    if (!isRecord(prompt)) {
      return [];
    }

    return compact([
      makeMessage(
        "user",
        textFromContent(prompt.text),
        undefined,
        prompt,
        `prompt-${index}`,
      ),
    ]);
  });
};

const messagesFromComposerData = (
  raw: string | undefined,
): RawHistoryMessage[] => {
  if (!raw) {
    return [];
  }

  const data = JSON.parse(raw) as unknown;

  if (!isRecord(data) || !Array.isArray(data.allComposers)) {
    return [];
  }

  return data.allComposers.flatMap((composer, index) => {
    if (!isRecord(composer)) {
      return [];
    }

    const title = typeof composer.name === "string" ? composer.name : "";
    const timestamp =
      typeof composer.lastUpdatedAt === "number"
        ? new Date(composer.lastUpdatedAt).toISOString()
        : undefined;

    return compact([
      makeMessage(
        "system",
        title ? `Cursor composer: ${title}` : "Cursor composer session",
        timestamp,
        composer,
        typeof composer.composerId === "string"
          ? composer.composerId
          : `composer-${index}`,
      ),
    ]);
  });
};

const compact = <T>(values: (T | undefined)[]): T[] =>
  values.filter((value): value is T => value !== undefined);

const messageFromCursorBubble = (
  bubble: unknown,
  index: number,
): RawHistoryMessage | undefined => {
  if (!isRecord(bubble)) {
    return undefined;
  }

  const role =
    bubble.type === 1 ? "user" : bubble.type === 2 ? "assistant" : undefined;

  if (!role) {
    return undefined;
  }

  const text =
    textFromContent(bubble.text) || textFromCursorRichText(bubble.richText);

  return makeMessage(
    role,
    text,
    dateFromStringOrNumber(bubble.createdAt),
    bubble,
    typeof bubble.bubbleId === "string" ? bubble.bubbleId : `bubble-${index}`,
  );
};

const textFromCursorRichText = (value: unknown): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "";
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    const parts: string[] = [];
    collectTextNodes(parsed, parts);
    return parts.join("\n").trim();
  } catch {
    return "";
  }
};

const collectTextNodes = (value: unknown, parts: string[]): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextNodes(item, parts);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (typeof value.text === "string") {
    parts.push(value.text);
  }

  if (Array.isArray(value.children)) {
    collectTextNodes(value.children, parts);
  }
};

const isCursorComposerHead = (value: unknown): value is CursorComposerHead =>
  isRecord(value) && typeof value.composerId === "string";

const tableExists = (database: Database, tableName: string): boolean =>
  Boolean(
    database
      .query("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(tableName),
  );

const dateFromMilliseconds = (value: number | undefined): string | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : undefined;

const dateFromStringOrNumber = (value: unknown): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  return typeof value === "string" ? value : undefined;
};

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

type CursorPokoImportMetadata = {
  sourceAgent?: string;
  sourceSessionId?: string;
  lineageId?: string;
};

const cursorPokoImportMetadata = (
  value: unknown,
): CursorPokoImportMetadata | undefined => {
  if (
    !isRecord(value) ||
    !isRecord(value.pokoImport) ||
    value.pokoImport.originator !== "poko"
  ) {
    return undefined;
  }

  return {
    sourceAgent: stringValue(value.pokoImport.sourceAgent),
    sourceSessionId: stringValue(value.pokoImport.sourceSessionId),
    lineageId: stringValue(value.pokoImport.lineageId),
  };
};

const isCursorPokoTaggedImport = (
  head: CursorComposerHead,
  composer: unknown,
): boolean =>
  cursorPokoImportMetadata(composer) !== undefined ||
  cursorPokoImportMetadata(head) !== undefined;

const pokoImportSessionMetadata = (
  metadata: CursorPokoImportMetadata | undefined,
): Partial<RawHistorySession> =>
  metadata
    ? {
        importedFromPoko: true,
        originAgent: metadata.sourceAgent,
        originSessionId: metadata.sourceSessionId,
        lineageId:
          metadata.lineageId ??
          (metadata.sourceAgent && metadata.sourceSessionId
            ? `${metadata.sourceAgent}:${metadata.sourceSessionId}`
            : undefined),
      }
    : {};
