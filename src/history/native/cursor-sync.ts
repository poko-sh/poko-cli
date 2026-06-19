import { Database } from "bun:sqlite";
import path from "node:path";
import { pathExists } from "../../core/config.ts";
import {
  ensureCursorStateDatabase,
  ensureCursorWorkspace,
  resolveCursorGlobalStateDbPath,
  resolveCursorWorkspaceStorageRoot,
} from "../cursor-storage.ts";
import {
  closeAppForNativeSync,
  type NativeAppController,
  type NativeAppLifecycle,
  reopenAppAfterNativeSync,
} from "./app-lifecycle.ts";
import {
  countConversationMessages,
  countSameAgentSessions,
  dateFrom,
  nativeTargetSessions,
  resolveRealProjectRoot,
} from "./common.ts";
import { backupCursorNativeDatabases } from "./cursor-backup.ts";
import { renderCursorImportSessions } from "./cursor-render.ts";
import { writeCursorImports } from "./cursor-write.ts";
import type {
  NativeHistorySyncer,
  NativeHistorySyncOptions,
  NativeHistorySyncResult,
} from "./types.ts";

type CursorNativeHistorySyncOptions = NativeHistorySyncOptions & {
  appController?: NativeAppController;
};

export const cursorNativeSyncer: NativeHistorySyncer = {
  id: "cursor",
  sync: syncCursorNativeHistory,
};

export async function syncCursorNativeHistory(
  options: CursorNativeHistorySyncOptions,
): Promise<NativeHistorySyncResult> {
  const storageRoot = resolveCursorWorkspaceStorageRoot();
  const globalStateDbPath = resolveCursorGlobalStateDbPath();
  const sessions = nativeTargetSessions(options.sessions, "cursor");
  const messageCount = countConversationMessages(sessions);
  const sameAgentSessions = countSameAgentSessions(options.sessions, "cursor");

  if (options.dryRun) {
    const renderedCount = sessions.reduce(
      (count, session) => count + (session.sourceAgent === "cursor" ? 1 : 2),
      0,
    );

    return {
      target: "cursor",
      location: globalStateDbPath,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: true,
      skipped: false,
      details: {
        composerRecordsWritten: renderedCount,
        bubblesWritten: messageCount,
        sessionsSkippedFromSameAgent: sameAgentSessions,
      },
    };
  }

  if (sessions.length === 0) {
    return {
      target: "cursor",
      location: globalStateDbPath,
      sessions: 0,
      messages: 0,
      dryRun: false,
      skipped: false,
      details: {
        composerRecordsWritten: 0,
        bubblesWritten: 0,
        staleComposersRemoved: 0,
        sessionsSkippedFromSameAgent: sameAgentSessions,
      },
    };
  }

  if (!(await pathExists(globalStateDbPath))) {
    return {
      target: "cursor",
      location: globalStateDbPath,
      sessions: 0,
      messages: 0,
      dryRun: false,
      skipped: true,
      reason: "Cursor global state.vscdb was not found.",
    };
  }

  const projectRoot = await resolveRealProjectRoot(options.root);
  const lifecycle = await closeCursorForNativeSync(options, projectRoot);

  if (lifecycle.reason || !lifecycle.safeToWrite) {
    return {
      target: "cursor",
      location: globalStateDbPath,
      sessions: 0,
      messages: 0,
      dryRun: false,
      skipped: true,
      reason:
        lifecycle.reason ??
        "Cursor native chat sync was skipped because its database was not safe to write.",
      details: {
        cursorWasRunning: lifecycle.wasRunning,
        cursorClosed: lifecycle.closed,
        cursorReopened: lifecycle.reopened,
      },
    };
  }

  let globalDatabase: Database | undefined;
  let workspaceDatabase: Database | undefined;
  let result: NativeHistorySyncResult = {
    target: "cursor",
    location: globalStateDbPath,
    sessions: 0,
    messages: 0,
    dryRun: false,
    skipped: true,
    reason: "Cursor native chat sync did not complete.",
    details: {
      cursorWasRunning: lifecycle.wasRunning,
      cursorClosed: lifecycle.closed,
      cursorReopened: lifecycle.reopened,
    },
  };

  try {
    const workspace = await ensureCursorWorkspace(storageRoot, projectRoot);
    const backup = await backupCursorNativeDatabases({
      root: options.root,
      globalStateDbPath,
      workspace,
    });
    options.logger?.info(
      `Backed up Cursor databases to ${path.relative(options.root, backup.directory)}`,
    );

    ensureCursorStateDatabase(globalStateDbPath, ["ItemTable", "cursorDiskKV"]);
    ensureCursorStateDatabase(workspace.databasePath, ["ItemTable"]);

    globalDatabase = new Database(globalStateDbPath);
    workspaceDatabase = new Database(workspace.databasePath);
    globalDatabase.run("pragma busy_timeout = 5000");
    workspaceDatabase.run("pragma busy_timeout = 5000");

    const fallbackDate = dateFrom(options.config.project.createdAt, new Date());
    const rendered = sessions.flatMap((session) =>
      renderCursorImportSessions({
        session,
        workspace,
        projectRoot,
        projectId: options.config.project.id,
        fallbackDate,
      }),
    );

    const archiveSessions = rendered.filter(
      (session) => session.importKind === "archive",
    ).length;
    const continuationSessions = rendered.filter(
      (session) => session.importKind === "continuation",
    ).length;

    const stats = writeCursorImports({
      globalDatabase,
      workspaceDatabase,
      workspace,
      projectRoot,
      rendered,
    });

    result = {
      target: "cursor",
      location: globalStateDbPath,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: false,
      skipped: false,
      details: {
        ...stats,
        cursorWasRunning: lifecycle.wasRunning,
        cursorClosed: lifecycle.closed,
        cursorReopened: lifecycle.reopened,
        sessionsSkippedFromSameAgent: sameAgentSessions,
        archiveSessions,
        continuationSessions,
        backupDirectory: backup.directory,
      },
    };
  } catch (error) {
    result = {
      target: "cursor",
      location: globalStateDbPath,
      sessions: 0,
      messages: 0,
      dryRun: false,
      skipped: true,
      reason: `Cursor native chat sync failed: ${errorMessage(error)}`,
      details: {
        cursorWasRunning: lifecycle.wasRunning,
        cursorClosed: lifecycle.closed,
        cursorReopened: lifecycle.reopened,
      },
    };
  } finally {
    workspaceDatabase?.close();
    globalDatabase?.close();
    await reopenCursorAfterNativeSync(options, lifecycle);
  }

  if (result.details) {
    result.details.cursorReopened = lifecycle.reopened;
  }

  return result;
}
const closeCursorForNativeSync = async (
  options: CursorNativeHistorySyncOptions,
  projectRoot: string,
): Promise<NativeAppLifecycle> =>
  closeAppForNativeSync({
    displayName: "Cursor",
    appNames: resolveCursorAppNames(),
    skipEnvVar: "POKO_CURSOR_SKIP_APP_LIFECYCLE",
    appController: options.appController,
    logger: options.logger,
    closeTimeoutMs: options.appController?.closeTimeoutMs ?? 60000,
    databaseReadyTimeoutMs: 30000,
    readinessAgent: "cursor",
    projectRoot,
  });

const reopenCursorAfterNativeSync = async (
  options: CursorNativeHistorySyncOptions,
  lifecycle: NativeAppLifecycle,
): Promise<void> =>
  reopenAppAfterNativeSync(
    {
      displayName: "Cursor",
      appNames: resolveCursorAppNames(),
      skipEnvVar: "POKO_CURSOR_SKIP_APP_LIFECYCLE",
      appController: options.appController,
      logger: options.logger,
    },
    lifecycle,
  );

const resolveCursorAppNames = (): string[] => {
  const names = [process.env.POKO_CURSOR_APP_NAME, "Cursor"].filter(
    (value): value is string => Boolean(value),
  );

  return [...new Set(names)];
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
