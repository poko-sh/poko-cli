import { realpath } from "node:fs/promises";
import path from "node:path";
import type {
  HistoryImporter,
  RawHistoryMessage,
  RawHistorySession,
} from "../types.ts";
import {
  dedupeMessages,
  homePath,
  isRecord,
  makeMessage,
  readJsonl,
  textFromContent,
  titleFrom,
  walkFiles,
} from "./common.ts";

export const claudeImporter: HistoryImporter = {
  id: "claude",
  displayName: "Claude Code",
  async capture(projectRoot) {
    const canonicalProjectRoot = await resolveCanonicalProjectRoot(projectRoot);
    const claudeHome =
      process.env.CLAUDE_CONFIG_DIR ??
      process.env.CLAUDE_HOME ??
      homePath(".claude");
    const projectsDir = path.join(claudeHome, "projects");
    const encoded = encodeClaudeProjectPath(canonicalProjectRoot);
    const preferredDir = path.join(projectsDir, encoded);
    const files = await walkFiles(preferredDir, (filePath) =>
      filePath.endsWith(".jsonl"),
    );
    const fallbackFiles =
      files.length > 0
        ? []
        : await walkFiles(projectsDir, (filePath) =>
            filePath.endsWith(".jsonl"),
          );

    return captureClaudeFiles(
      [...files, ...fallbackFiles],
      [projectRoot, canonicalProjectRoot],
      projectRoot,
    );
  },
  async captureAll() {
    const claudeHome =
      process.env.CLAUDE_CONFIG_DIR ??
      process.env.CLAUDE_HOME ??
      homePath(".claude");
    const files = await walkFiles(
      path.join(claudeHome, "projects"),
      (filePath) => filePath.endsWith(".jsonl"),
    );

    return captureClaudeFiles(files);
  },
};

const captureClaudeFiles = async (
  files: string[],
  acceptedProjectRoots?: string[],
  projectRootOverride?: string,
): Promise<RawHistorySession[]> => {
  const sessions = new Map<string, RawHistorySession>();
  const acceptedRootSet = acceptedProjectRoots
    ? new Set(acceptedProjectRoots)
    : undefined;

  for (const filePath of files) {
    const rows = await readJsonl(filePath);
    const rowsBySession = groupClaudeRows(rows, acceptedRootSet);

    for (const matchingRows of rowsBySession.values()) {
      const importMetadata = matchingRows
        .map(claudePokoImportMetadata)
        .find(Boolean);

      if (matchingRows.some(isPokoClaudeImportRow) && !importMetadata) {
        continue;
      }

      const firstRow = matchingRows[0];

      if (!firstRow) {
        continue;
      }

      const messages = dedupeMessages(
        matchingRows.flatMap(extractClaudeMessage),
      );

      if (messages.length === 0) {
        continue;
      }

      sessions.set(`${firstRow.cwd}:${firstRow.sessionId}`, {
        schemaVersion: 1,
        id: firstRow.sessionId,
        sourceAgent: "claude",
        ...pokoImportSessionMetadata(importMetadata),
        title: titleFrom("Claude Code session", messages),
        projectRoot: projectRootOverride ?? firstRow.cwd,
        createdAt: firstTimestamp(messages),
        updatedAt: latestTimestamp(messages),
        sourcePath: filePath,
        messages,
        rawEvents: messages.map((message) => message.raw),
      });
    }
  }

  return [...sessions.values()];
};

type ClaudeSessionRow = Record<string, unknown> & {
  cwd: string;
  sessionId: string;
};

const groupClaudeRows = (
  rows: unknown[],
  acceptedRootSet?: Set<string>,
): Map<string, ClaudeSessionRow[]> => {
  const rowsBySession = new Map<string, ClaudeSessionRow[]>();

  for (const row of rows) {
    if (!isClaudeSessionRow(row)) {
      continue;
    }

    if (acceptedRootSet && !acceptedRootSet.has(row.cwd)) {
      continue;
    }

    const key = `${row.cwd}:${row.sessionId}`;
    const sessionRows = rowsBySession.get(key) ?? [];
    sessionRows.push(row);
    rowsBySession.set(key, sessionRows);
  }

  return rowsBySession;
};

const isClaudeSessionRow = (row: unknown): row is ClaudeSessionRow =>
  isRecord(row) &&
  typeof row.cwd === "string" &&
  typeof row.sessionId === "string";

const extractClaudeMessage = (row: unknown): RawHistoryMessage[] => {
  if (!isRecord(row) || !isRecord(row.message)) {
    return [];
  }

  const type = row.type;
  const timestamp =
    typeof row.timestamp === "string" ? row.timestamp : undefined;
  const id = typeof row.uuid === "string" ? row.uuid : undefined;
  const message = row.message;

  if (type === "user") {
    return compact([
      makeMessage("user", textFromContent(message.content), timestamp, row, id),
    ]);
  }

  if (type === "assistant") {
    return compact([
      makeMessage(
        "assistant",
        textFromContent(message.content),
        timestamp,
        row,
        id,
      ),
    ]);
  }

  return [];
};

const encodeClaudeProjectPath = (projectRoot: string): string =>
  projectRoot.normalize("NFC").replace(/[^a-zA-Z0-9]/g, "-");

const resolveCanonicalProjectRoot = async (
  projectRoot: string,
): Promise<string> => {
  try {
    return (await realpath(projectRoot)).normalize("NFC");
  } catch {
    return path.resolve(projectRoot).normalize("NFC");
  }
};

const firstTimestamp = (messages: RawHistoryMessage[]): string | undefined =>
  messages
    .map((message) => message.timestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort()
    .at(0);

const latestTimestamp = (messages: RawHistoryMessage[]): string | undefined =>
  messages
    .map((message) => message.timestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort()
    .at(-1);

const compact = <T>(values: (T | undefined)[]): T[] =>
  values.filter((value): value is T => value !== undefined);

type ClaudePokoImportMetadata = {
  sourceAgent?: string;
  sourceSessionId?: string;
  lineageId?: string;
};

const claudePokoImportMetadata = (
  row: unknown,
): ClaudePokoImportMetadata | undefined => {
  if (!isRecord(row) || row.version !== "poko-import") {
    return undefined;
  }

  if (!isRecord(row.pokoImport)) {
    return undefined;
  }

  const metadata = {
    sourceAgent: stringValue(row.pokoImport.sourceAgent),
    sourceSessionId: stringValue(row.pokoImport.sourceSessionId),
    lineageId: stringValue(row.pokoImport.lineageId),
  };

  return metadata.lineageId ||
    (metadata.sourceAgent && metadata.sourceSessionId)
    ? metadata
    : undefined;
};

const isPokoClaudeImportRow = (row: unknown): boolean =>
  isRecord(row) && row.version === "poko-import";

const pokoImportSessionMetadata = (
  metadata: ClaudePokoImportMetadata | undefined,
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

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;
