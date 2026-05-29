import { Database } from "bun:sqlite";
import { execFile } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { RawHistoryMessage, RawHistorySession } from "../types.ts";
import {
  conversationMessages,
  countConversationMessages,
  countSameAgentSessions,
  dateFrom,
  deterministicPrefixedId,
  errorMessage,
  messageDate,
  nativeTargetSessions,
  resolveRealProjectRoot,
  sessionCreatedDate,
  sessionUpdatedDate,
  slugify,
  timestampMs,
  truncate,
  writeAtomic,
} from "./common.ts";
import type {
  NativeHistorySyncer,
  NativeHistorySyncOptions,
  NativeHistorySyncResult,
} from "./types.ts";

type OpenCodeExport = {
  info: Record<string, unknown>;
  messages: Array<{
    info: Record<string, unknown>;
    parts: Array<Record<string, unknown>>;
  }>;
};

type OpenCodeModel = {
  providerID: string;
  modelID: string;
};

const execFileAsync = promisify(execFile);
const FALLBACK_OPENCODE_IMPORT_MODEL: OpenCodeModel = {
  providerID: "opencode",
  modelID: "big-pickle",
};
const OPENCODE_IMPORT_AGENT = "general";

export const openCodeNativeSyncer: NativeHistorySyncer = {
  id: "opencode",
  sync: syncOpenCodeNativeHistory,
};

export async function syncOpenCodeNativeHistory(
  options: NativeHistorySyncOptions,
): Promise<NativeHistorySyncResult> {
  const nativeDir = path.join(options.root, ".poko", "native", "opencode");
  const sessions = nativeTargetSessions(options.sessions, "opencode");
  const messageCount = countConversationMessages(sessions);

  if (options.dryRun) {
    return {
      target: "opencode",
      location: nativeDir,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: true,
      skipped: false,
      details: {
        exportFilesWritten: sessions.length,
        importCommandsRun: sessions.length,
        sessionsSkippedFromSameAgent: countSameAgentSessions(
          options.sessions,
          "opencode",
        ),
      },
    };
  }

  const projectRoot = await resolveRealProjectRoot(options.root);
  const fallbackDate = dateFrom(options.config.project.createdAt, new Date());
  const opencodeBin = process.env.POKO_OPENCODE_BIN ?? "opencode";
  const importModel = await resolveOpenCodeImportModel(
    opencodeBin,
    projectRoot,
  );
  const exportFiles: string[] = [];

  await cleanOpenCodeNativeDir(nativeDir);

  for (const session of sessions) {
    const sessionId = openCodeSessionId(session);
    const exportPath = path.join(nativeDir, `${sessionId}.json`);
    await writeAtomic(
      exportPath,
      JSON.stringify(
        renderOpenCodeExport(session, projectRoot, fallbackDate, importModel),
        null,
        2,
      ),
    );
    exportFiles.push(exportPath);
  }

  const sessionsReplaced = await cleanupExistingPokoOpenCodeImports({
    opencodeBin,
    projectRoot,
  });
  let importsRun = 0;

  for (const exportPath of exportFiles) {
    try {
      await execFileAsync(opencodeBin, ["import", exportPath], {
        cwd: projectRoot,
      });
      importsRun += 1;
    } catch (error) {
      return {
        target: "opencode",
        location: nativeDir,
        sessions: importsRun,
        messages: messageCount,
        dryRun: false,
        skipped: true,
        reason: `OpenCode import command failed after writing export files: ${formatExecError(error)}`,
        details: {
          exportFilesWritten: exportFiles.length,
          importCommandsRun: importsRun,
          sessionsReplaced,
          sessionsSkippedFromSameAgent: countSameAgentSessions(
            options.sessions,
            "opencode",
          ),
        },
      };
    }
  }

  return {
    target: "opencode",
    location: nativeDir,
    sessions: sessions.length,
    messages: messageCount,
    dryRun: false,
    skipped: false,
    details: {
      exportFilesWritten: exportFiles.length,
      importCommandsRun: importsRun,
      sessionsReplaced,
      sessionsSkippedFromSameAgent: countSameAgentSessions(
        options.sessions,
        "opencode",
      ),
    },
  };
}

const renderOpenCodeExport = (
  session: RawHistorySession,
  projectRoot: string,
  fallbackDate: Date,
  importModel: OpenCodeModel,
): OpenCodeExport => {
  const sessionId = openCodeSessionId(session);
  const created = sessionCreatedDate(session, fallbackDate);
  const updated = sessionUpdatedDate(session, created);
  const messages = conversationMessages(session);

  return {
    info: {
      id: sessionId,
      slug: slugify(session.title || session.id),
      projectID: "poko-import",
      directory: projectRoot,
      path: ".",
      title: truncate(session.title || "Poko import", 120),
      version: "poko-import",
      cost: 0,
      tokens: emptyTokens(),
      time: {
        created: timestampMs(created),
        updated: timestampMs(updated),
      },
    },
    messages: messages.map((message, index) =>
      renderOpenCodeMessage({
        session,
        sessionId,
        message,
        index,
        created,
        projectRoot,
        importModel,
        previousMessage: messages[index - 1],
      }),
    ),
  };
};

const renderOpenCodeMessage = (input: {
  session: RawHistorySession;
  sessionId: string;
  message: RawHistoryMessage;
  index: number;
  created: Date;
  projectRoot: string;
  importModel: OpenCodeModel;
  previousMessage?: RawHistoryMessage;
}): OpenCodeExport["messages"][number] => {
  const messageId = openCodeMessageId(
    input.session,
    input.message,
    input.index,
  );
  const created = messageDate(input.message, input.created);
  const createdMs = timestampMs(created, input.index);
  const baseInfo = {
    id: messageId,
    sessionID: input.sessionId,
  };
  const parts = [
    {
      id: deterministicPrefixedId(
        "prt",
        `poko:opencode:part:${input.session.sourceAgent}:${input.session.id}:${messageId}`,
      ),
      sessionID: input.sessionId,
      messageID: messageId,
      type: "text",
      text: input.message.text,
      time: {
        start: createdMs,
        end: createdMs,
      },
    },
  ];

  if (input.message.role === "user") {
    return {
      info: {
        ...baseInfo,
        role: "user",
        time: { created: createdMs },
        agent: OPENCODE_IMPORT_AGENT,
        model: {
          providerID: input.importModel.providerID,
          modelID: input.importModel.modelID,
        },
      },
      parts,
    };
  }

  return {
    info: {
      ...baseInfo,
      role: "assistant",
      time: {
        created: createdMs,
        completed: createdMs,
      },
      parentID: input.previousMessage
        ? openCodeMessageId(
            input.session,
            input.previousMessage,
            input.index - 1,
          )
        : deterministicPrefixedId(
            "msg",
            `poko:opencode:message-root:${input.session.sourceAgent}:${input.session.id}`,
          ),
      providerID: input.importModel.providerID,
      modelID: input.importModel.modelID,
      mode: OPENCODE_IMPORT_AGENT,
      agent: OPENCODE_IMPORT_AGENT,
      path: {
        cwd: input.projectRoot,
        root: input.projectRoot,
      },
      cost: 0,
      tokens: emptyTokens(),
    },
    parts,
  };
};

const openCodeSessionId = (session: RawHistorySession): string =>
  deterministicPrefixedId(
    "ses",
    `poko:opencode:session:${session.sourceAgent}:${session.id}`,
  );

const openCodeMessageId = (
  session: RawHistorySession,
  message: RawHistoryMessage,
  index: number,
): string =>
  deterministicPrefixedId(
    "msg",
    `poko:opencode:message:${session.sourceAgent}:${session.id}:${message.id ?? index}:${message.role}`,
  );

const emptyTokens = (): Record<string, unknown> => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cache: {
    read: 0,
    write: 0,
  },
});

const resolveOpenCodeImportModel = async (
  opencodeBin: string,
  projectRoot: string,
): Promise<OpenCodeModel> => {
  const envModel = parseOpenCodeModel(process.env.POKO_OPENCODE_IMPORT_MODEL);

  if (envModel) {
    return envModel;
  }

  const recentModels = await readOpenCodeRecentModels();
  const recentModel = recentModels[0];

  if (recentModel) {
    return recentModel;
  }

  const availableModels = await listOpenCodeModels(opencodeBin, projectRoot);
  return availableModels[0] ?? FALLBACK_OPENCODE_IMPORT_MODEL;
};

const listOpenCodeModels = async (
  opencodeBin: string,
  projectRoot: string,
): Promise<OpenCodeModel[]> => {
  try {
    const { stdout } = await execFileAsync(opencodeBin, ["models"], {
      cwd: projectRoot,
    });

    return stdout
      .split("\n")
      .map((line) => parseOpenCodeModel(line.trim()))
      .filter((model): model is OpenCodeModel => Boolean(model));
  } catch {
    return [];
  }
};

const readOpenCodeRecentModels = async (): Promise<OpenCodeModel[]> => {
  try {
    const raw = await readFile(
      path.join(
        process.env.XDG_STATE_HOME ??
          path.join(os.homedir(), ".local", "state"),
        "opencode",
        "model.json",
      ),
      "utf8",
    );
    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed) || !Array.isArray(parsed.recent)) {
      return [];
    }

    return parsed.recent
      .map((item) =>
        isRecord(item)
          ? {
              providerID:
                typeof item.providerID === "string" ? item.providerID : "",
              modelID: typeof item.modelID === "string" ? item.modelID : "",
            }
          : undefined,
      )
      .filter(
        (model): model is OpenCodeModel =>
          Boolean(model?.providerID) && Boolean(model?.modelID),
      );
  } catch {
    return [];
  }
};

const parseOpenCodeModel = (
  value: string | undefined,
): OpenCodeModel | undefined => {
  if (!value) {
    return undefined;
  }

  const [providerID, ...modelParts] = value.split("/");
  const modelID = modelParts.join("/");

  if (!providerID || !modelID) {
    return undefined;
  }

  return { providerID, modelID };
};

const cleanOpenCodeNativeDir = async (nativeDir: string): Promise<void> => {
  const entries = await readdir(nativeDir, { withFileTypes: true }).catch(
    () => undefined,
  );

  if (!entries) {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) =>
        rm(path.join(nativeDir, entry.name), {
          force: true,
        }),
      ),
  );
};

const cleanupExistingPokoOpenCodeImports = async (options: {
  opencodeBin: string;
  projectRoot: string;
}): Promise<number> => {
  const dbPath = await resolveOpenCodeDbPath(
    options.opencodeBin,
    options.projectRoot,
  );

  if (!dbPath) {
    return 0;
  }

  let database: Database;

  try {
    database = new Database(dbPath);
  } catch {
    return 0;
  }

  try {
    database.run("pragma busy_timeout = 5000");

    if (!tableExists(database, "session")) {
      return 0;
    }

    const sessionRows = database
      .query(
        "select id from session where version = ? and directory = ? order by id",
      )
      .all("poko-import", options.projectRoot) as Array<{ id: string }>;

    let removed = 0;
    const deleteSession = database.transaction((sessionId: string) => {
      database.query("delete from part where session_id = ?").run(sessionId);
      database.query("delete from message where session_id = ?").run(sessionId);
      database.query("delete from session where id = ?").run(sessionId);
    });

    for (const row of sessionRows) {
      deleteSession(row.id);
      removed += 1;
    }

    return removed;
  } finally {
    database.close();
  }
};

const resolveOpenCodeDbPath = async (
  opencodeBin: string,
  projectRoot: string,
): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync(opencodeBin, ["db", "path"], {
      cwd: projectRoot,
    });
    const dbPath = stdout.trim();
    return dbPath.length > 0 ? dbPath : undefined;
  } catch {
    return undefined;
  }
};

const tableExists = (database: Database, tableName: string): boolean =>
  Boolean(
    database
      .query("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(tableName),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const formatExecError = (error: unknown): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    typeof error.stderr === "string" &&
    error.stderr.trim().length > 0
  ) {
    return error.stderr.trim();
  }

  return errorMessage(error);
};
