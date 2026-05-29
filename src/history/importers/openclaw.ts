import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  resolveOpenClawAgentSessionsDir,
  resolveOpenClawStateDir,
} from "../openclaw.ts";
import type {
  HistoryImporter,
  RawHistoryMessage,
  RawHistorySession,
} from "../types.ts";
import {
  dedupeMessages,
  isRecord,
  makeMessage,
  readJsonl,
  textFromContent,
  titleFrom,
  walkFiles,
} from "./common.ts";

export const openClawImporter: HistoryImporter = {
  id: "openclaw",
  displayName: "OpenClaw",
  async capture(projectRoot) {
    const acceptedRoots = unique([
      projectRoot,
      await resolveCanonicalProjectRoot(projectRoot),
    ]);
    const sessionDirs = await resolveOpenClawCandidateSessionDirs();
    const files = (
      await Promise.all(
        sessionDirs.map((directory) =>
          walkFiles(directory, (filePath) => filePath.endsWith(".jsonl")),
        ),
      )
    ).flat();

    return captureOpenClawFiles(projectRoot, acceptedRoots, unique(files));
  },
};

const captureOpenClawFiles = async (
  projectRoot: string,
  acceptedProjectRoots: string[],
  files: string[],
): Promise<RawHistorySession[]> => {
  const acceptedRootSet = new Set(acceptedProjectRoots);
  const sessions = new Map<string, RawHistorySession>();

  for (const filePath of files) {
    const rows = await readJsonl(filePath);
    const header = rows.find(isOpenClawSessionHeader);

    if (!header || !acceptedRootSet.has(header.cwd)) {
      continue;
    }

    if (rows.some(isPokoOpenClawImportRow)) {
      continue;
    }

    const messages = dedupeMessages(rows.flatMap(extractOpenClawMessage));

    if (messages.length === 0) {
      continue;
    }

    sessions.set(header.id, {
      schemaVersion: 1,
      id: header.id,
      sourceAgent: "openclaw",
      title: openClawSessionTitle(rows, messages),
      projectRoot,
      createdAt: header.timestamp,
      updatedAt: latestTimestamp(rows, messages) ?? header.timestamp,
      sourcePath: filePath,
      messages,
      rawEvents: rows,
    });
  }

  return [...sessions.values()];
};

const resolveOpenClawCandidateSessionDirs = async (): Promise<string[]> => {
  const defaultDir = resolveOpenClawAgentSessionsDir();
  const agentsDir = path.join(resolveOpenClawStateDir(), "agents");

  try {
    const entries = await readdir(agentsDir, { withFileTypes: true });
    return unique([
      defaultDir,
      ...entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(agentsDir, entry.name, "sessions")),
    ]);
  } catch {
    return [defaultDir];
  }
};

const extractOpenClawMessage = (row: unknown): RawHistoryMessage[] => {
  if (!isRecord(row) || row.type !== "message" || !isRecord(row.message)) {
    return [];
  }

  const role = row.message.role;

  if (role !== "user" && role !== "assistant") {
    return [];
  }

  return compact([
    makeMessage(
      role,
      textFromContent(row.message.content ?? row.message.text),
      typeof row.timestamp === "string" ? row.timestamp : undefined,
      row,
      typeof row.id === "string" ? row.id : undefined,
    ),
  ]);
};

const openClawSessionTitle = (
  rows: unknown[],
  messages: RawHistoryMessage[],
): string => {
  const named = rows
    .filter(isOpenClawSessionInfo)
    .map((row) => row.name)
    .filter((name): name is string => Boolean(name))
    .at(-1);

  return named ?? titleFrom("OpenClaw session", messages);
};

const isOpenClawSessionHeader = (
  row: unknown,
): row is {
  type: "session";
  id: string;
  timestamp: string;
  cwd: string;
} =>
  isRecord(row) &&
  row.type === "session" &&
  typeof row.id === "string" &&
  typeof row.timestamp === "string" &&
  typeof row.cwd === "string";

const isOpenClawSessionInfo = (
  row: unknown,
): row is { type: "session_info"; name?: string; timestamp?: string } =>
  isRecord(row) &&
  row.type === "session_info" &&
  (typeof row.name === "string" || row.name === undefined);

const isPokoOpenClawImportRow = (row: unknown): boolean =>
  isRecord(row) &&
  row.type === "custom" &&
  row.customType === "poko.import" &&
  isRecord(row.data) &&
  row.data.originator === "poko";

const latestTimestamp = (
  rows: unknown[],
  messages: RawHistoryMessage[],
): string | undefined =>
  [
    ...rows
      .map((row) =>
        isRecord(row) && typeof row.timestamp === "string"
          ? row.timestamp
          : undefined,
      )
      .filter((timestamp): timestamp is string => Boolean(timestamp)),
    ...messages
      .map((message) => message.timestamp)
      .filter((timestamp): timestamp is string => Boolean(timestamp)),
  ]
    .sort()
    .at(-1);

const resolveCanonicalProjectRoot = async (
  projectRoot: string,
): Promise<string> => {
  try {
    return (await realpath(projectRoot)).normalize("NFC");
  } catch {
    return path.resolve(projectRoot).normalize("NFC");
  }
};

const unique = <T>(values: Array<T | undefined>): T[] => [
  ...new Set(values.filter((value): value is T => value !== undefined)),
];

const compact = <T>(values: (T | undefined)[]): T[] =>
  values.filter((value): value is T => value !== undefined);
