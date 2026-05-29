import { Database } from "bun:sqlite";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { resolveHermesStateDbPath } from "../hermes.ts";
import type {
  HistoryImporter,
  RawHistoryMessage,
  RawHistorySession,
} from "../types.ts";
import {
  dedupeMessages,
  isRecord,
  makeMessage,
  textFromContent,
  titleFrom,
} from "./common.ts";

type HermesSessionRow = {
  id: string;
  source: string;
  model: string | null;
  model_config: string | null;
  system_prompt: string | null;
  started_at: number;
  ended_at: number | null;
  title: string | null;
};

type HermesMessageRow = {
  id: number;
  role: string;
  content: string | null;
  timestamp: number;
};

export const hermesImporter: HistoryImporter = {
  id: "hermes",
  displayName: "Hermes Agent",
  async capture(projectRoot) {
    const dbPath = resolveHermesStateDbPath();
    let database: Database;

    try {
      database = new Database(dbPath, { readonly: true });
    } catch {
      return [];
    }

    try {
      database.run("pragma busy_timeout = 1000");

      if (
        !tableExists(database, "sessions") ||
        !tableExists(database, "messages")
      ) {
        return [];
      }

      const acceptedRoots = unique([
        projectRoot,
        await resolveCanonicalProjectRoot(projectRoot),
      ]);
      const rows = database
        .query(
          "select id, source, model, model_config, system_prompt, started_at, ended_at, title from sessions order by started_at desc",
        )
        .all() as HermesSessionRow[];
      const sessions: RawHistorySession[] = [];

      for (const row of rows) {
        const modelConfig = parseJsonObject(row.model_config);

        if (isPokoHermesImport(row, modelConfig)) {
          continue;
        }

        if (!matchesProject(row, modelConfig, acceptedRoots)) {
          continue;
        }

        const messageRows = database
          .query(
            "select id, role, content, timestamp from messages where session_id = ? order by id",
          )
          .all(row.id) as HermesMessageRow[];
        const messages = dedupeMessages(
          messageRows.flatMap(extractHermesMessage),
        );

        if (messages.length === 0) {
          continue;
        }

        sessions.push({
          schemaVersion: 1,
          id: row.id,
          sourceAgent: "hermes",
          title: row.title?.trim() || titleFrom("Hermes session", messages),
          projectRoot,
          createdAt: secondsToIso(row.started_at),
          updatedAt: secondsToIso(row.ended_at ?? latestSeconds(messageRows)),
          sourcePath: dbPath,
          messages,
          rawEvents: messageRows,
        });
      }

      return sessions;
    } finally {
      database.close();
    }
  },
};

const extractHermesMessage = (row: HermesMessageRow): RawHistoryMessage[] => {
  if (row.role !== "user" && row.role !== "assistant") {
    return [];
  }

  return compact([
    makeMessage(
      row.role,
      hermesContentText(row.content),
      secondsToIso(row.timestamp),
      row,
      String(row.id),
    ),
  ]);
};

const hermesContentText = (content: string | null): string => {
  if (!content) {
    return "";
  }

  const jsonPrefix = "\u0000json:";
  if (!content.startsWith(jsonPrefix)) {
    return content;
  }

  try {
    return textFromContent(JSON.parse(content.slice(jsonPrefix.length)));
  } catch {
    return content.slice(jsonPrefix.length);
  }
};

const matchesProject = (
  row: HermesSessionRow,
  modelConfig: Record<string, unknown> | undefined,
  acceptedRoots: string[],
): boolean => {
  const prompt = row.system_prompt ?? "";

  if (acceptedRoots.some((root) => prompt.includes(root))) {
    return true;
  }

  const projectRoot = nestedString(modelConfig, ["pokoImport", "projectRoot"]);
  const cwd =
    nestedString(modelConfig, ["cwd"]) ??
    nestedString(modelConfig, ["projectRoot"]) ??
    nestedString(modelConfig, ["workspace", "cwd"]);

  return (
    acceptedRoots.includes(projectRoot ?? "") ||
    acceptedRoots.includes(cwd ?? "")
  );
};

const isPokoHermesImport = (
  row: Pick<HermesSessionRow, "source">,
  modelConfig: Record<string, unknown> | undefined,
): boolean =>
  row.source === "poko" ||
  nestedString(modelConfig, ["pokoImport", "originator"]) === "poko";

const parseJsonObject = (
  value: string | null,
): Record<string, unknown> | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const nestedString = (
  value: unknown,
  pathParts: string[],
): string | undefined => {
  let current = value;

  for (const part of pathParts) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[part];
  }

  return typeof current === "string" && current.trim().length > 0
    ? current
    : undefined;
};

const secondsToIso = (value: number | null | undefined): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const ms = value > 1_000_000_000_000 ? value : value * 1000;
  return new Date(ms).toISOString();
};

const latestSeconds = (rows: HermesMessageRow[]): number | undefined =>
  rows
    .map((row) => row.timestamp)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)
    .at(-1);

const tableExists = (database: Database, tableName: string): boolean =>
  Boolean(
    database
      .query("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(tableName),
  );

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
