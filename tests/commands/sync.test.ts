import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { runCapture } from "../../src/commands/capture.ts";
import { runInit } from "../../src/commands/init.ts";
import { runSync, runSyncReport } from "../../src/commands/sync.ts";
import { syncNativeHistoryTargets } from "../../src/history/native/index.ts";
import {
  syncT3CodeNativeHistory,
  type T3CodeAppController,
} from "../../src/history/native/t3code.ts";
import type { RawHistorySession } from "../../src/history/types.ts";
import { createMemoryLogger, makeTempDir, removeTempDir } from "../helpers.ts";

let cwd: string;
let codexHome: string;
let claudeHome: string;
let cursorStorage: string;
let cursorGlobalStateDbPath: string;
let t3DbPath: string;
let piHome: string;
let hermesHome: string;
let openClawStateDir: string;
let oldCodexHome: string | undefined;
let oldClaudeHome: string | undefined;
let oldClaudeConfigDir: string | undefined;
let oldCursorStorage: string | undefined;
let oldCursorGlobalStateDb: string | undefined;
let oldCursorSkipAppLifecycle: string | undefined;
let oldT3CodeDbPath: string | undefined;
let oldT3CodeSkipAppLifecycle: string | undefined;
let oldOpenCodeBin: string | undefined;
let oldOpenCodeImportModel: string | undefined;
let oldPiAgentDir: string | undefined;
let oldPiImportModel: string | undefined;
let oldHermesHome: string | undefined;
let oldOpenClawStateDir: string | undefined;

beforeEach(async () => {
  cwd = await makeTempDir();
  codexHome = await makeTempDir();
  claudeHome = await makeTempDir();
  cursorStorage = await makeTempDir();
  cursorGlobalStateDbPath = path.join(await makeTempDir(), "state.vscdb");
  t3DbPath = path.join(await makeTempDir(), "state.sqlite");
  piHome = await makeTempDir();
  hermesHome = await makeTempDir();
  openClawStateDir = await makeTempDir();
  oldCodexHome = process.env.CODEX_HOME;
  oldClaudeHome = process.env.CLAUDE_HOME;
  oldClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  oldCursorStorage = process.env.POKO_CURSOR_STORAGE_ROOT;
  oldCursorGlobalStateDb = process.env.POKO_CURSOR_GLOBAL_STATE_DB;
  oldCursorSkipAppLifecycle = process.env.POKO_CURSOR_SKIP_APP_LIFECYCLE;
  oldT3CodeDbPath = process.env.POKO_T3CODE_DB_PATH;
  oldT3CodeSkipAppLifecycle = process.env.POKO_T3CODE_SKIP_APP_LIFECYCLE;
  oldOpenCodeBin = process.env.POKO_OPENCODE_BIN;
  oldOpenCodeImportModel = process.env.POKO_OPENCODE_IMPORT_MODEL;
  oldPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  oldPiImportModel = process.env.POKO_PI_IMPORT_MODEL;
  oldHermesHome = process.env.HERMES_HOME;
  oldOpenClawStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_HOME = claudeHome;
  process.env.CLAUDE_CONFIG_DIR = claudeHome;
  process.env.POKO_CURSOR_STORAGE_ROOT = cursorStorage;
  process.env.POKO_CURSOR_GLOBAL_STATE_DB = cursorGlobalStateDbPath;
  process.env.POKO_CURSOR_SKIP_APP_LIFECYCLE = "1";
  process.env.POKO_T3CODE_DB_PATH = t3DbPath;
  process.env.POKO_T3CODE_SKIP_APP_LIFECYCLE = "1";
  process.env.POKO_OPENCODE_IMPORT_MODEL = "opencode/big-pickle";
  process.env.PI_CODING_AGENT_DIR = piHome;
  process.env.POKO_PI_IMPORT_MODEL = "anthropic/claude-sonnet-4-5";
  process.env.HERMES_HOME = hermesHome;
  process.env.OPENCLAW_STATE_DIR = openClawStateDir;
  delete process.env.POKO_OPENCODE_BIN;
  createCursorGlobalStateDb(cursorGlobalStateDbPath);
  createT3CodeStateDb(t3DbPath);
  await runInit({ cwd, logger: createMemoryLogger() });
  await writeFile(
    path.join(cwd, ".poko/rules.md"),
    "# Project Rules\n\nUse the project rules.\n",
    "utf8",
  );
  await writeFile(
    path.join(cwd, ".poko/mcp.json"),
    JSON.stringify({
      mcpServers: {
        docs: {
          url: "https://example.com/mcp",
        },
      },
    }),
    "utf8",
  );
});

afterEach(async () => {
  restoreEnv("CODEX_HOME", oldCodexHome);
  restoreEnv("CLAUDE_HOME", oldClaudeHome);
  restoreEnv("CLAUDE_CONFIG_DIR", oldClaudeConfigDir);
  restoreEnv("POKO_CURSOR_STORAGE_ROOT", oldCursorStorage);
  restoreEnv("POKO_CURSOR_GLOBAL_STATE_DB", oldCursorGlobalStateDb);
  restoreEnv("POKO_CURSOR_SKIP_APP_LIFECYCLE", oldCursorSkipAppLifecycle);
  restoreEnv("POKO_T3CODE_DB_PATH", oldT3CodeDbPath);
  restoreEnv("POKO_T3CODE_SKIP_APP_LIFECYCLE", oldT3CodeSkipAppLifecycle);
  restoreEnv("POKO_OPENCODE_BIN", oldOpenCodeBin);
  restoreEnv("POKO_OPENCODE_IMPORT_MODEL", oldOpenCodeImportModel);
  restoreEnv("PI_CODING_AGENT_DIR", oldPiAgentDir);
  restoreEnv("POKO_PI_IMPORT_MODEL", oldPiImportModel);
  restoreEnv("HERMES_HOME", oldHermesHome);
  restoreEnv("OPENCLAW_STATE_DIR", oldOpenClawStateDir);
  await removeTempDir(cwd);
  await removeTempDir(codexHome);
  await removeTempDir(claudeHome);
  await removeTempDir(cursorStorage);
  await removeTempDir(piHome);
  await removeTempDir(hermesHome);
  await removeTempDir(openClawStateDir);
  await removeTempDir(path.dirname(cursorGlobalStateDbPath));
  await removeTempDir(path.dirname(t3DbPath));
});

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
};

describe("poko sync", () => {
  test("syncs public alpha defaults on --all", async () => {
    const results = await runSync({
      cwd,
      all: true,
      dryRun: true,
      logger: createMemoryLogger(),
    });

    const paths = results.map((result) => result.path);
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain("CLAUDE.md");
    expect(paths).toContain(".codex/config.toml");
    expect(paths).toContain(".mcp.json");
    expect(paths).not.toContain("opencode.json");
    expect(paths).not.toContain(".cursor/rules/poko.mdc");
    expect(paths).not.toContain(".gemini/settings.json");
    expect(paths).not.toContain(".aider.conf.yml");
  });

  test("supports common agent aliases", async () => {
    const results = await runSync({
      cwd,
      agent: "t3",
      dryRun: true,
      logger: createMemoryLogger(),
    });

    expect(results.map((result) => result.path)).toContain("AGENTS.md");
  });

  test("supports OpenCode aliases", async () => {
    const results = await runSync({
      cwd,
      agent: "oc",
      dryRun: true,
      logger: createMemoryLogger(),
    });

    expect(results.map((result) => result.path)).toContain("AGENTS.md");
  });

  test("supports Pi aliases", async () => {
    const results = await runSync({
      cwd,
      agent: "pi-coding-agent",
      dryRun: true,
      logger: createMemoryLogger(),
    });

    expect(results.map((result) => result.path)).toContain("AGENTS.md");
  });

  test("supports Hermes and OpenClaw aliases", async () => {
    const hermesResults = await runSync({
      cwd,
      agent: "hermes-agent",
      dryRun: true,
      logger: createMemoryLogger(),
    });
    const openClawResults = await runSync({
      cwd,
      agent: "claw",
      dryRun: true,
      logger: createMemoryLogger(),
    });

    expect(hermesResults.map((result) => result.path)).toContain("AGENTS.md");
    expect(openClawResults.map((result) => result.path)).toContain("AGENTS.md");
  });

  test("does not generate static files without user-provided context", async () => {
    await rm(path.join(cwd, ".poko/rules.md"), { force: true });
    await rm(path.join(cwd, ".poko/mcp.json"), { force: true });

    const results = await runSync({
      cwd,
      agent: "cursor",
      dryRun: true,
      logger: createMemoryLogger(),
    });

    expect(results).toEqual([]);
  });

  test("syncs only MCP config when MCP is the only source", async () => {
    await rm(path.join(cwd, ".poko/rules.md"), { force: true });

    const results = await runSync({
      cwd,
      agent: "cursor",
      dryRun: true,
      logger: createMemoryLogger(),
    });

    expect(results.map((result) => result.path)).toEqual([".cursor/mcp.json"]);
  });

  test("dry-run includes session and native target details", async () => {
    await configureRepoHistoryStore();
    await seedCodexSession();
    const logger = createMemoryLogger();

    await runSync({
      cwd,
      agent: "claude",
      dryRun: true,
      logger,
    });

    const output = logger.messages.join("\n");
    expect(output).toContain("would include 1 project history session");
    expect(output).toContain("- Sync history");
    expect(output).toContain("source: codex");
    expect(output).toContain(
      "would sync 1 session(s), 2 message(s) into claude native history",
    );
    expect(output).toContain("location:");
    expect(output).toContain("details:");
    expect(output).toContain("sessionsSkippedFromSameAgent=0");
  });

  test("Codex and Claude dry-run JSON reports the public alpha native targets", async () => {
    await configureRepoHistoryStore();
    await seedCodexSession();
    await seedClaudeSession();

    const report = await runSyncReport({
      cwd,
      targets: "codex,claude",
      dryRun: true,
      quiet: true,
      logger: createMemoryLogger(),
    });

    expect(report.agents).toEqual(["codex", "claude"]);
    expect(report.history?.sessions).toHaveLength(2);
    expect(report.history?.nativeTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "codex",
          sessions: 1,
          messages: 2,
          dryRun: true,
        }),
        expect.objectContaining({
          target: "claude",
          sessions: 1,
          messages: 2,
          dryRun: true,
        }),
      ]),
    );
    expect(report.historyCompatibility.primaryRoutes).toContain(
      "Codex ↔ Claude Code — full native chat import and resume",
    );
    expect(report.warnings).toEqual([]);
  });

  test("global dry-run captures every Codex project and reports native targets", async () => {
    const otherRoot = await makeTempDir();

    try {
      await seedCodexSession({
        id: "global-current",
        title: "Current global session",
        projectRoot: cwd,
      });
      await seedCodexSession({
        id: "global-other",
        title: "Other global session",
        projectRoot: otherRoot,
        startedAt: "2026-05-29T00:10:00.000Z",
      });

      const report = await runSyncReport({
        cwd,
        global: true,
        agent: "claude",
        dryRun: true,
        quiet: true,
        logger: createMemoryLogger(),
      });

      expect(report.mode).toBe("global");
      expect(report.files).toEqual([]);
      expect(report.changedFiles).toBe(0);
      expect(report.agents).toEqual(["claude"]);
      expect(report.history?.sessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "global-current",
            projectRoot: cwd,
            sourceAgent: "codex",
          }),
          expect.objectContaining({
            id: "global-other",
            projectRoot: otherRoot,
            sourceAgent: "codex",
          }),
        ]),
      );
      expect(report.global?.projects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ root: cwd, sessions: 1, messages: 2 }),
          expect.objectContaining({
            root: otherRoot,
            sessions: 1,
            messages: 2,
          }),
        ]),
      );
      expect(report.history?.nativeTargets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            target: "claude",
            projectRoot: cwd,
            sessions: 1,
            dryRun: true,
          }),
          expect.objectContaining({
            target: "claude",
            projectRoot: otherRoot,
            sessions: 1,
            dryRun: true,
          }),
        ]),
      );
    } finally {
      await removeTempDir(otherRoot);
    }
  });

  test("global sync writes per-project Claude native history", async () => {
    const otherRoot = await makeTempDir();

    try {
      await seedCodexSession({
        id: "global-write-current",
        title: "Current project write",
        projectRoot: cwd,
      });
      await seedCodexSession({
        id: "global-write-other",
        title: "Other project write",
        projectRoot: otherRoot,
        startedAt: "2026-05-29T00:20:00.000Z",
      });

      const report = await runSyncReport({
        cwd,
        global: true,
        agent: "claude",
        logger: createMemoryLogger(),
      });

      expect(report.mode).toBe("global");
      expect(report.history?.nativeTargets).toHaveLength(2);

      const currentProjectDir = path.join(
        claudeHome,
        "projects",
        encodeClaudePath(await canonicalPath(cwd)),
      );
      const otherProjectDir = path.join(
        claudeHome,
        "projects",
        encodeClaudePath(await canonicalPath(otherRoot)),
      );

      expect(
        (await listFiles(currentProjectDir)).filter((filePath) =>
          filePath.endsWith(".jsonl"),
        ),
      ).toHaveLength(1);
      expect(
        (await listFiles(otherProjectDir)).filter((filePath) =>
          filePath.endsWith(".jsonl"),
        ),
      ).toHaveLength(1);
    } finally {
      await removeTempDir(otherRoot);
    }
  });

  test("dry-run reports same-agent skips for every native target", async () => {
    const config = JSON.parse(
      await readFile(path.join(cwd, ".poko/poko.json"), "utf8"),
    ) as Parameters<typeof syncNativeHistoryTargets>[0]["config"];

    const results = await syncNativeHistoryTargets({
      root: cwd,
      config,
      targetAgents: [
        "codex",
        "claude",
        "cursor",
        "t3code",
        "opencode",
        "pi",
        "hermes",
        "openclaw",
      ],
      dryRun: true,
      sessions: [
        makeRawSession({ id: "codex-same", sourceAgent: "codex" }),
        makeRawSession({ id: "claude-same", sourceAgent: "claude" }),
        makeRawSession({ id: "cursor-same", sourceAgent: "cursor" }),
        makeRawSession({ id: "t3-same", sourceAgent: "t3code" }),
        makeRawSession({ id: "opencode-same", sourceAgent: "opencode" }),
        makeRawSession({ id: "pi-same", sourceAgent: "pi" }),
        makeRawSession({ id: "hermes-same", sourceAgent: "hermes" }),
        makeRawSession({ id: "openclaw-same", sourceAgent: "openclaw" }),
      ],
    });

    for (const result of results) {
      expect(result.details?.sessionsSkippedFromSameAgent).toBe(1);
      expect(result.sessions).toBe(7);
    }
  });

  test("syncs project history into T3 Code native history", async () => {
    await configureRepoHistoryStore();
    await seedCodexSession();
    const logger = createMemoryLogger();

    const results = await runSync({
      cwd,
      agent: "t3code",
      logger,
    });
    const paths = results.map((result) => result.path);
    expect(paths).toContain("AGENTS.md");
    expect(paths).not.toContain(".poko/handoffs/t3code-latest.md");
    expect(logger.messages.join("\n")).toContain(
      "synced 1 session(s), 2 message(s) into t3code native history",
    );

    const database = new Database(t3DbPath, { readonly: true });
    try {
      expect(
        database
          .query(
            "select count(*) as count from orchestration_events where event_type = 'thread.created'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(
        database
          .query(
            "select json_extract(payload_json, '$.text') as text from orchestration_events where event_type = 'thread.message-sent' order by occurred_at",
          )
          .all(),
      ).toEqual([{ text: "sync chats too" }, { text: "history synced" }]);
      expect(
        database
          .query(
            "select event_type from orchestration_events order by sequence",
          )
          .all(),
      ).toEqual([
        { event_type: "project.created" },
        { event_type: "thread.created" },
        { event_type: "thread.message-sent" },
        { event_type: "thread.turn-start-requested" },
        { event_type: "thread.message-sent" },
        { event_type: "thread.turn-diff-completed" },
      ]);
    } finally {
      database.close();
    }

    await runSync({
      cwd,
      agent: "t3code",
      logger: createMemoryLogger(),
    });

    const idempotentDatabase = new Database(t3DbPath, { readonly: true });
    try {
      expect(
        idempotentDatabase
          .query(
            "select event_type, count(*) as count from orchestration_events group by event_type order by event_type",
          )
          .all(),
      ).toEqual([
        { event_type: "project.created", count: 1 },
        { event_type: "thread.created", count: 1 },
        { event_type: "thread.message-sent", count: 2 },
        { event_type: "thread.turn-diff-completed", count: 1 },
        { event_type: "thread.turn-start-requested", count: 1 },
      ]);
    } finally {
      idempotentDatabase.close();
    }
  });

  test("closes and reopens T3 Code around native history writes", async () => {
    restoreEnv("POKO_T3CODE_SKIP_APP_LIFECYCLE", oldT3CodeSkipAppLifecycle);
    const logger = createMemoryLogger();
    const config = JSON.parse(
      await readFile(path.join(cwd, ".poko/poko.json"), "utf8"),
    ) as Parameters<typeof syncT3CodeNativeHistory>[0]["config"];
    let running = true;
    const lifecycleEvents: string[] = [];
    const appController: T3CodeAppController = {
      platform: "darwin",
      appNames: ["T3 Code (Alpha)"],
      async isRunning() {
        return running;
      },
      async quit(appName) {
        lifecycleEvents.push(`quit:${appName}`);
        running = false;
      },
      async open(appName) {
        lifecycleEvents.push(`open:${appName}`);
        running = true;
      },
      async wait() {},
    };

    const result = await syncT3CodeNativeHistory({
      root: cwd,
      config,
      logger,
      appController,
      sessions: [makeRawSession()],
    });

    expect(result.skipped).toBe(false);
    expect(lifecycleEvents).toEqual([
      "quit:T3 Code (Alpha)",
      "open:T3 Code (Alpha)",
    ]);
    expect(logger.messages.join("\n")).toContain(
      "Poko needs to close T3 Code to sync your data",
    );
    expect(logger.messages.join("\n")).toContain("T3 Code is closed");
    expect(logger.messages.join("\n")).toContain("Reopening T3 Code");
    expect(result.details?.t3CodeReopened).toBe(true);

    const database = new Database(t3DbPath, { readonly: true });
    try {
      expect(
        database
          .query(
            "select count(*) as count from orchestration_events where event_type = 'thread.created'",
          )
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  test("syncs Claude project history into Codex native history", async () => {
    await configureRepoHistoryStore();
    await seedClaudeSession();
    const logger = createMemoryLogger();

    await runSync({
      cwd,
      agent: "codex",
      logger,
    });

    expect(logger.messages.join("\n")).toContain(
      "synced 1 session(s), 2 message(s) into codex native history",
    );

    const rolloutFiles = await listFiles(path.join(codexHome, "sessions"));
    expect(rolloutFiles).toHaveLength(1);
    expect(path.basename(rolloutFiles[0] ?? "")).toMatch(
      /^rollout-2026-05-29T00-00-01-[0-9a-f-]+\.jsonl$/,
    );

    const rows = (await readFile(rolloutFiles[0] ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; payload?: unknown });
    expect(rows[0]?.type).toBe("session_meta");
    expect(
      (rows[0]?.payload as { model_provider?: unknown } | undefined)
        ?.model_provider,
    ).toBe("openai");
    expect(rows.map((row) => row.type)).toEqual([
      "session_meta",
      "event_msg",
      "response_item",
      "event_msg",
      "response_item",
      "event_msg",
      "event_msg",
    ]);
    expect(
      await readFile(path.join(codexHome, "session_index.jsonl"), "utf8"),
    ).toContain("Claude seed");

    await runSync({
      cwd,
      agent: "codex",
      logger: createMemoryLogger(),
    });

    const idempotentRolloutFiles = await listFiles(
      path.join(codexHome, "sessions"),
    );
    expect(idempotentRolloutFiles).toHaveLength(1);
    const indexRows = (
      await readFile(path.join(codexHome, "session_index.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { thread_name?: string });
    expect(
      indexRows.filter((row) => row.thread_name === "Claude seed"),
    ).toHaveLength(1);
  });

  test("syncs Codex project history into Claude native history", async () => {
    await configureRepoHistoryStore();
    await seedCodexSession();
    const canonicalCwd = await canonicalPath(cwd);
    const projectDir = path.join(
      claudeHome,
      "projects",
      encodeClaudePath(canonicalCwd),
    );
    await seedStalePokoClaudeImport(projectDir);
    const logger = createMemoryLogger();

    await runSync({
      cwd,
      agent: "claude",
      logger,
    });

    expect(logger.messages.join("\n")).toContain(
      "synced 1 session(s), 2 message(s) into claude native history",
    );

    const sessionFiles = await listFiles(projectDir);
    expect(sessionFiles).toHaveLength(1);

    const rows = (await readFile(sessionFiles[0] ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows[0]?.type).toBe("custom-title");
    expect(rows[0]?.customTitle).toBe("Sync history");
    expect(rows[1]?.type).toBe("user");
    expect(rows[2]?.type).toBe("assistant");
    expect(rows[1]?.cwd).toBe(canonicalCwd);
    expect(rows[2]?.parentUuid).toBe(rows[1]?.uuid);
  });

  test("syncs Codex project history into Cursor native history", async () => {
    await configureRepoHistoryStore();
    await seedCodexSession();
    await seedStalePokoCursorImport();
    const logger = createMemoryLogger();

    await runSync({
      cwd,
      agent: "cursor",
      logger,
    });

    expect(logger.messages.join("\n")).toContain(
      "synced 1 session(s), 2 message(s) into cursor native history",
    );
    expect(logger.messages.join("\n")).toContain("staleComposersRemoved=1");
    expect(logger.messages.join("\n")).toContain(
      "read-only archive + Continue chat",
    );
    expect(logger.messages.join("\n")).toContain("reading only");
    expect(logger.messages.join("\n")).toContain("Backed up Cursor databases");

    const workspaceDirs = await readdir(cursorStorage);
    expect(workspaceDirs).toHaveLength(1);

    const database = new Database(cursorGlobalStateDbPath, { readonly: true });
    try {
      const headers = JSON.parse(
        String(
          (
            database
              .query("select value from ItemTable where key = ?")
              .get("composer.composerHeaders") as { value: string }
          ).value,
        ),
      ) as { allComposers: Array<{ composerId: string; name: string }> };
      expect(headers.allComposers).toHaveLength(2);
      const archiveHead = headers.allComposers.find((head) =>
        head.name?.startsWith("[History]"),
      );
      const continuationHead = headers.allComposers.find((head) =>
        head.name?.startsWith("Continue:"),
      );
      expect(archiveHead?.name).toBe("[History] Sync history");
      expect(continuationHead?.name).toBe("Continue: Sync history");
      expect(archiveHead?.composerId).not.toBe("stale-composer");

      const composerId = archiveHead?.composerId ?? "";
      const composer = JSON.parse(
        String(
          (
            database
              .query("select value from cursorDiskKV where key = ?")
              .get(`composerData:${composerId}`) as { value: string }
          ).value,
        ),
      ) as {
        agentBackend: string;
        status: string;
        modelConfig: { modelName: string };
        pokoImport: { originator: string; readOnly?: boolean };
        fullConversationHeadersOnly: Array<{ bubbleId: string; type: number }>;
      };
      expect(composer.agentBackend).toBe("cursor-agent");
      expect(composer.status).toBe("none");
      expect(composer.modelConfig.modelName).toBe("composer-2.5");
      expect(composer.pokoImport.originator).toBe("poko");
      expect(composer.pokoImport.readOnly).toBe(true);
      expect(
        composer.fullConversationHeadersOnly.map((head) => head.type),
      ).toEqual([1, 2]);

      const continuation = JSON.parse(
        String(
          (
            database
              .query("select value from cursorDiskKV where key = ?")
              .get(`composerData:${continuationHead?.composerId ?? ""}`) as {
              value: string;
            }
          ).value,
        ),
      ) as {
        pokoImport: { continuation?: boolean };
        fullConversationHeadersOnly: Array<{ type: number }>;
      };
      expect(continuation.pokoImport.continuation).toBe(true);
      expect(
        continuation.fullConversationHeadersOnly.map((head) => head.type),
      ).toEqual([1, 2]);

      const bubbleRows = database
        .query("select value from cursorDiskKV where key like ? order by key")
        .all(`bubbleId:${composerId}:%`) as Array<{ value: string }>;
      const bubbleTexts = bubbleRows
        .map((row) => JSON.parse(String(row.value)) as { text: string })
        .map((bubble) => bubble.text)
        .sort();
      expect(bubbleTexts).toEqual(["history synced", "sync chats too"]);
      expect(
        database
          .query("select value from cursorDiskKV where key = ?")
          .get("composerData:stale-composer"),
      ).toBeNull();
    } finally {
      database.close();
    }

    const captureLogger = createMemoryLogger();
    const captured = await runCapture({
      cwd,
      agent: "cursor",
      store: "repo",
      logger: captureLogger,
    });
    expect(captured).toBe(0);
    expect(captureLogger.messages.join("\n")).toContain(
      "no matching history found",
    );
  });

  test("renders Cursor feature annotations as native bubble metadata", async () => {
    await configureRepoHistoryStore();
    await seedCodexFeatureSession();

    await runSync({
      cwd,
      agent: "cursor",
      logger: createMemoryLogger(),
    });

    const database = new Database(cursorGlobalStateDbPath, { readonly: true });
    try {
      const headers = JSON.parse(
        String(
          (
            database
              .query("select value from ItemTable where key = ?")
              .get("composer.composerHeaders") as { value: string }
          ).value,
        ),
      ) as { allComposers: Array<{ composerId: string; name: string }> };
      const archiveHead = headers.allComposers.find((head) =>
        head.name?.startsWith("[History]"),
      );
      const composerId = archiveHead?.composerId ?? "";
      const composer = JSON.parse(
        String(
          (
            database
              .query("select value from cursorDiskKV where key = ?")
              .get(`composerData:${composerId}`) as { value: string }
          ).value,
        ),
      ) as { fullConversationHeadersOnly: Array<{ bubbleId: string }> };
      expect(composer.fullConversationHeadersOnly).toHaveLength(4);

      const bubbles = database
        .query("select value from cursorDiskKV where key like ? order by key")
        .all(`bubbleId:${composerId}:%`)
        .map((row) =>
          JSON.parse(String((row as { value: string }).value)),
        ) as Array<{
        text?: string;
        thinking?: { text?: string };
        fileLinks?: string[];
        toolFormerData?: { name?: string; result?: string };
      }>;
      const assistantBubble = bubbles.find((bubble) =>
        bubble.text?.includes("Feature matrix response"),
      );
      const thinkingBubble = bubbles.find((bubble) => bubble.thinking);
      const toolBubble = bubbles.find((bubble) => bubble.toolFormerData);

      expect(assistantBubble?.text).not.toContain("[thinking]");
      expect(assistantBubble?.text).not.toContain("[tool_use");
      expect(assistantBubble?.thinking).toBeUndefined();
      expect(thinkingBubble?.thinking?.text).toContain(
        "inspect the project registry",
      );
      expect(assistantBubble?.fileLinks?.join("\n")).toContain(
        ".poko/poko.json",
      );
      expect(toolBubble?.toolFormerData?.name).toBe("read_file");
      expect(toolBubble?.toolFormerData?.result).toContain("schemaVersion=1");
    } finally {
      database.close();
    }
  });

  test("renders Claude feature annotations as native content blocks", async () => {
    await configureRepoHistoryStore();
    await seedCodexFeatureSession();
    const logger = createMemoryLogger();

    await runSync({
      cwd,
      agent: "claude",
      logger,
    });

    const canonicalCwd = await canonicalPath(cwd);
    const projectDir = path.join(
      claudeHome,
      "projects",
      encodeClaudePath(canonicalCwd),
    );
    const sessionFiles = await listFiles(projectDir);
    const rows = (await readFile(sessionFiles[0] ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const assistantRow = rows.find((row) => row.type === "assistant") as {
      message?: { content?: Array<Record<string, unknown>> };
      uuid?: string;
    };
    const toolResultRow = rows.find(
      (row) =>
        row.type === "user" &&
        row.message &&
        JSON.stringify(row.message).includes("tool_result"),
    ) as { message?: { content?: Array<Record<string, unknown>> } };
    const content = assistantRow.message?.content ?? [];
    const textPart = content.find((part) => part.type === "text");
    const thinkingPart = content.find((part) => part.type === "thinking");
    const toolUsePart = content.find((part) => part.type === "tool_use");
    const resultPart = toolResultRow.message?.content?.[0];

    expect(textPart?.text).toBe(
      "Feature matrix response: file path, reasoning marker, and tool marker preserved.",
    );
    expect(textPart?.text).not.toContain("[thinking]");
    expect(thinkingPart?.thinking).toContain("inspect the project registry");
    expect(toolUsePart).toMatchObject({
      type: "tool_use",
      name: "Read",
      input: { file_path: ".poko/poko.json:45" },
    });
    expect(resultPart).toMatchObject({
      type: "tool_result",
      content: "schemaVersion=1",
    });
    expect(resultPart?.tool_use_id).toBe(toolUsePart?.id);
  });

  test("renders Codex feature annotations as native transcript events", async () => {
    await configureRepoHistoryStore();
    await seedClaudeFeatureSession();

    await runSync({
      cwd,
      agent: "codex",
      logger: createMemoryLogger(),
    });

    const sessionFiles = await listFiles(path.join(codexHome, "sessions"));
    const rows = (await readFile(sessionFiles[0] ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const payloads = rows
      .filter((row) => row.type === "response_item")
      .map((row) => row.payload as Record<string, unknown>);

    expect(payloads.map((payload) => payload.type)).toEqual([
      "message",
      "reasoning",
      "message",
      "function_call",
      "function_call_output",
    ]);
    expect(JSON.stringify(payloads)).not.toContain("[thinking]");
    expect(JSON.stringify(payloads)).not.toContain("[tool_use");
    expect(JSON.stringify(payloads[1]?.summary)).toContain(
      "inspect the project registry",
    );
    expect(payloads[1]?.content).toBeNull();
    expect(payloads[2]).toMatchObject({
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "Feature matrix response: file path, reasoning marker, and tool marker preserved.",
        },
      ],
    });
    expect(payloads[3]).toMatchObject({
      type: "function_call",
      name: "exec_command",
    });
    expect(payloads[3]?.arguments).toContain(".poko/poko.json:45");
    expect(payloads[4]).toMatchObject({
      type: "function_call_output",
      output: "schemaVersion=1",
    });

    const eventPayloads = rows
      .filter((row) => row.type === "event_msg")
      .map((row) => row.payload as Record<string, unknown>);
    expect(eventPayloads.map((payload) => payload.type)).toEqual([
      "turn_started",
      "user_message",
      "agent_reasoning",
      "agent_message",
      "exec_command_end",
      "task_complete",
    ]);
    expect(eventPayloads[2]).toMatchObject({
      type: "agent_reasoning",
      text: "inspect the project registry before editing",
    });
    expect(eventPayloads[3]?.type).toBe("agent_message");
    expect(eventPayloads[3]?.message).toContain(
      "Feature matrix response: file path, reasoning marker, and tool marker preserved.",
    );
    expect(eventPayloads[3]?.message).toContain("**Reasoning**");
    expect(eventPayloads[3]?.message).toContain("**Tool: Read**");
    expect(eventPayloads[3]?.message).toContain("schemaVersion=1");
    expect(eventPayloads[4]).toMatchObject({
      type: "exec_command_end",
      aggregated_output: "schemaVersion=1",
      status: "completed",
    });
    expect(JSON.stringify(eventPayloads[4])).toContain(".poko/poko.json:45");
  });

  test("syncs project history into OpenCode through its import command", async () => {
    await configureRepoHistoryStore();
    await seedCodexSession();
    const opencodeLog = path.join(cwd, "opencode.log");
    const opencodeDbPath = path.join(cwd, "opencode-state.sqlite");
    createOpenCodeStateDb(opencodeDbPath);
    await seedStaleOpenCodeImport(opencodeDbPath);
    process.env.POKO_OPENCODE_BIN = await createFakeOpenCodeBin(
      opencodeLog,
      opencodeDbPath,
    );
    const logger = createMemoryLogger();

    await runSync({
      cwd,
      agent: "opencode",
      logger,
    });

    expect(logger.messages.join("\n")).toContain(
      "synced 1 session(s), 2 message(s) into opencode native history",
    );
    expect(logger.messages.join("\n")).toContain("sessionsReplaced=1");

    const exportFiles = await listFiles(
      path.join(cwd, ".poko/native/opencode"),
    );
    expect(exportFiles).toHaveLength(1);

    const exported = JSON.parse(
      await readFile(exportFiles[0] ?? "", "utf8"),
    ) as {
      info: { id: string; slug: string; model?: unknown };
      messages: Array<{
        info: {
          role: string;
          model?: { providerID: string; modelID: string };
          providerID?: string;
          modelID?: string;
        };
        parts: Array<{ text: string }>;
      }>;
    };
    expect(exported.info.id).toStartWith("ses_");
    expect(exported.info.slug).toBe("sync-history");
    expect(exported.info.model).toBeUndefined();
    expect(exported.messages.map((message) => message.info.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(exported.messages[0]?.info.model).toEqual({
      providerID: "opencode",
      modelID: "big-pickle",
    });
    expect(exported.messages[1]?.info.providerID).toBe("opencode");
    expect(exported.messages[1]?.info.modelID).toBe("big-pickle");
    expect(exported.messages[0]?.parts[0]?.text).toBe("sync chats too");

    expect(await readFile(opencodeLog, "utf8")).toContain(
      `import ${exportFiles[0]}`,
    );

    const database = new Database(opencodeDbPath, { readonly: true });
    try {
      expect(
        database.query("select count(*) as count from session").get(),
      ).toEqual({ count: 0 });
      expect(
        database.query("select count(*) as count from message").get(),
      ).toEqual({ count: 0 });
      expect(
        database.query("select count(*) as count from part").get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("renders OpenCode feature annotations as native parts", async () => {
    await configureRepoHistoryStore();
    await seedCodexFeatureSession();
    const opencodeLog = path.join(cwd, "opencode.log");
    const opencodeDbPath = path.join(cwd, "opencode-state.sqlite");
    createOpenCodeStateDb(opencodeDbPath);
    process.env.POKO_OPENCODE_BIN = await createFakeOpenCodeBin(
      opencodeLog,
      opencodeDbPath,
    );

    await runSync({
      cwd,
      agent: "opencode",
      logger: createMemoryLogger(),
    });

    const exportFiles = await listFiles(
      path.join(cwd, ".poko/native/opencode"),
    );
    const exported = JSON.parse(
      await readFile(exportFiles[0] ?? "", "utf8"),
    ) as {
      messages: Array<{
        info: { role: string };
        parts: Array<Record<string, unknown>>;
      }>;
    };
    const assistant = exported.messages.find(
      (message) => message.info.role === "assistant",
    );

    expect(assistant?.parts.map((part) => part.type)).toEqual([
      "reasoning",
      "text",
      "tool",
    ]);
    expect(JSON.stringify(assistant?.parts)).not.toContain("[thinking]");
    expect(JSON.stringify(assistant?.parts)).not.toContain("[tool_use");
    expect(assistant?.parts[0]?.text).toContain("inspect the project registry");
    expect(assistant?.parts[1]?.text).toBe(
      "Feature matrix response: file path, reasoning marker, and tool marker preserved.",
    );
    expect(assistant?.parts[2]).toMatchObject({
      type: "tool",
      tool: "Read",
      state: {
        status: "completed",
        output: "schemaVersion=1",
      },
    });
  });

  test("syncs Codex project history into Pi native history", async () => {
    await configureRepoHistoryStore();
    await seedCodexSession();
    const canonicalCwd = await canonicalPath(cwd);
    await seedStalePokoPiImport(canonicalCwd);
    const logger = createMemoryLogger();

    await runSync({
      cwd,
      agent: "pi",
      logger,
    });

    expect(logger.messages.join("\n")).toContain(
      "synced 1 session(s), 2 message(s) into pi native history",
    );
    expect(logger.messages.join("\n")).toContain("staleSessionFilesRemoved=1");

    const sessionFiles = await listFiles(
      path.join(piHome, "sessions", encodePiPath(canonicalCwd)),
    );
    expect(sessionFiles).toHaveLength(1);

    const rows = (await readFile(sessionFiles[0] ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows[0]).toMatchObject({
      type: "session",
      version: 3,
      cwd: canonicalCwd,
    });
    expect(rows[1]).toMatchObject({
      type: "custom",
      customType: "poko.import",
    });
    expect(rows[2]).toMatchObject({
      type: "session_info",
      name: "Sync history",
    });
    expect(rows[3]).toMatchObject({
      type: "message",
      message: { role: "user", content: "sync chats too" },
    });
    expect(rows[4]).toMatchObject({
      type: "message",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      },
    });
  });

  test("renders Pi feature annotations as typed content and tool result", async () => {
    await configureRepoHistoryStore();
    await seedCodexFeatureSession();

    await runSync({
      cwd,
      agent: "pi",
      logger: createMemoryLogger(),
    });

    const canonicalCwd = await canonicalPath(cwd);
    const sessionFiles = await listFiles(
      path.join(piHome, "sessions", encodePiPath(canonicalCwd)),
    );
    const rows = (await readFile(sessionFiles[0] ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const assistant = rows.find(
      (row) =>
        row.type === "message" &&
        (row.message as { role?: string } | undefined)?.role === "assistant",
    ) as { message?: { content?: Array<Record<string, unknown>> } };
    const toolResult = rows.find(
      (row) =>
        row.type === "message" &&
        (row.message as { role?: string } | undefined)?.role === "toolResult",
    ) as { message?: Record<string, unknown> };

    expect(assistant.message?.content?.map((part) => part.type)).toEqual([
      "thinking",
      "text",
      "toolCall",
    ]);
    expect(JSON.stringify(assistant.message?.content)).not.toContain(
      "[thinking]",
    );
    expect(JSON.stringify(assistant.message?.content)).not.toContain(
      "[tool_use",
    );
    expect(assistant.message?.content?.[0]?.thinking).toContain(
      "inspect the project registry",
    );
    expect(assistant.message?.content?.[1]?.text).toBe(
      "Feature matrix response: file path, reasoning marker, and tool marker preserved.",
    );
    expect(assistant.message?.content?.[2]).toMatchObject({
      type: "toolCall",
      name: "Read",
      arguments: { file_path: ".poko/poko.json:45" },
    });
    expect(toolResult.message).toMatchObject({
      role: "toolResult",
      toolName: "Read",
      isError: false,
    });
    expect(JSON.stringify(toolResult.message)).toContain("schemaVersion=1");
  });

  test("syncs Codex project history into Hermes native history", async () => {
    await configureRepoHistoryStore();
    await seedCodexSession();
    await seedStalePokoHermesImport();
    const logger = createMemoryLogger();

    await runSync({
      cwd,
      agent: "hermes",
      logger,
    });

    expect(logger.messages.join("\n")).toContain(
      "synced 1 session(s), 2 message(s) into hermes native history",
    );
    expect(logger.messages.join("\n")).toContain("staleSessionsRemoved=1");

    const database = new Database(path.join(hermesHome, "state.db"), {
      readonly: true,
    });
    try {
      expect(
        database
          .query("select title, source from sessions where source = ?")
          .all("poko"),
      ).toEqual([{ title: "Sync history", source: "poko" }]);
      expect(
        database.query("select role, content from messages order by id").all(),
      ).toEqual([
        { role: "user", content: "sync chats too" },
        { role: "assistant", content: "history synced" },
      ]);
    } finally {
      database.close();
    }

    const captured = await runCapture({
      cwd,
      agent: "hermes",
      store: "repo",
      logger: createMemoryLogger(),
    });
    expect(captured).toBe(0);
  });

  test("renders Hermes feature annotations into reasoning and tool columns", async () => {
    await configureRepoHistoryStore();
    await seedCodexFeatureSession();

    await runSync({
      cwd,
      agent: "hermes",
      logger: createMemoryLogger(),
    });

    const database = new Database(path.join(hermesHome, "state.db"), {
      readonly: true,
    });
    try {
      expect(
        database
          .query("select tool_call_count from sessions where source = ?")
          .get("poko"),
      ).toEqual({ tool_call_count: 1 });
      const assistant = database
        .query(
          "select content, tool_name, tool_calls, reasoning from messages where role = ?",
        )
        .get("assistant") as {
        content: string;
        tool_name: string;
        tool_calls: string;
        reasoning: string;
      };

      expect(assistant.content).toBe(
        "Feature matrix response: file path, reasoning marker, and tool marker preserved.",
      );
      expect(assistant.content).not.toContain("[thinking]");
      expect(assistant.reasoning).toContain("inspect the project registry");
      expect(assistant.tool_name).toBe("Read");
      expect(assistant.tool_calls).toContain(".poko/poko.json:45");
      expect(assistant.tool_calls).toContain("schemaVersion=1");
    } finally {
      database.close();
    }
  });

  test("syncs Codex project history into OpenClaw native history", async () => {
    await configureRepoHistoryStore();
    await seedCodexSession();
    const canonicalCwd = await canonicalPath(cwd);
    await seedStalePokoOpenClawImport(canonicalCwd);
    const logger = createMemoryLogger();

    await runSync({
      cwd,
      agent: "openclaw",
      logger,
    });

    expect(logger.messages.join("\n")).toContain(
      "synced 1 session(s), 2 message(s) into openclaw native history",
    );
    expect(logger.messages.join("\n")).toContain("staleSessionFilesRemoved=1");

    const sessionDir = path.join(
      openClawStateDir,
      "agents",
      "main",
      "sessions",
    );
    const sessionFiles = (await listFiles(sessionDir)).filter((filePath) =>
      filePath.endsWith(".jsonl"),
    );
    expect(sessionFiles).toHaveLength(1);

    const rows = (await readFile(sessionFiles[0] ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows[0]).toMatchObject({
      type: "session",
      version: 3,
      cwd: canonicalCwd,
    });
    expect(rows[1]).toMatchObject({
      type: "custom",
      customType: "poko.import",
    });
    expect(rows[2]).toMatchObject({
      type: "session_info",
      name: "Sync history",
    });
    expect(rows[3]).toMatchObject({
      type: "message",
      message: { role: "user", content: "sync chats too" },
    });
    expect(rows[4]).toMatchObject({
      type: "message",
      message: { role: "assistant" },
    });

    const sessionStore = JSON.parse(
      await readFile(path.join(sessionDir, "sessions.json"), "utf8"),
    ) as Record<string, { sessionId: string; displayName: string }>;
    expect(Object.values(sessionStore)).toEqual([
      expect.objectContaining({ displayName: "Sync history" }),
    ]);
  });

  test("renders OpenClaw feature annotations as typed content and tool result", async () => {
    await configureRepoHistoryStore();
    await seedCodexFeatureSession();

    await runSync({
      cwd,
      agent: "openclaw",
      logger: createMemoryLogger(),
    });

    const canonicalCwd = await canonicalPath(cwd);
    const sessionDir = path.join(
      openClawStateDir,
      "agents",
      "main",
      "sessions",
    );
    const sessionFiles = (await listFiles(sessionDir)).filter((filePath) =>
      filePath.endsWith(".jsonl"),
    );
    const rows = (await readFile(sessionFiles[0] ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const assistant = rows.find(
      (row) =>
        row.type === "message" &&
        (row.message as { role?: string } | undefined)?.role === "assistant",
    ) as { message?: { content?: Array<Record<string, unknown>> } };
    const toolResult = rows.find(
      (row) =>
        row.type === "message" &&
        (row.message as { role?: string } | undefined)?.role === "toolResult",
    ) as { message?: Record<string, unknown> };

    expect(rows[0]).toMatchObject({ cwd: canonicalCwd });
    expect(assistant.message?.content?.map((part) => part.type)).toEqual([
      "thinking",
      "text",
      "toolCall",
    ]);
    expect(JSON.stringify(assistant.message?.content)).not.toContain(
      "[thinking]",
    );
    expect(JSON.stringify(assistant.message?.content)).not.toContain(
      "[tool_use",
    );
    expect(toolResult.message).toMatchObject({
      role: "toolResult",
      toolName: "Read",
      isError: false,
    });
  });
});

const makeRawSession = (
  options: { id?: string; sourceAgent?: string } = {},
): RawHistorySession => ({
  schemaVersion: 1,
  id: options.id ?? "native-close-session",
  sourceAgent: (options.sourceAgent ??
    "codex") as RawHistorySession["sourceAgent"],
  title: "Native close session",
  projectRoot: cwd,
  createdAt: "2026-05-29T00:00:00.000Z",
  updatedAt: "2026-05-29T00:00:02.000Z",
  messages: [
    {
      role: "user",
      text: "please sync this safely",
      timestamp: "2026-05-29T00:00:01.000Z",
    },
    {
      role: "assistant",
      text: "done safely",
      timestamp: "2026-05-29T00:00:02.000Z",
    },
  ],
});

const createT3CodeStateDb = (dbPath: string): void => {
  const database = new Database(dbPath);

  try {
    // Match a minimally initialized T3 Code store. Projection tables are owned
    // by T3 migrations and should not be pre-created by Poko test fixtures.
    database.run(`
      create table orchestration_events (
        sequence integer primary key autoincrement,
        event_id text not null unique,
        aggregate_kind text not null,
        stream_id text not null,
        stream_version integer not null,
        event_type text not null,
        occurred_at text not null,
        command_id text,
        causation_event_id text,
        correlation_id text,
        actor_kind text not null,
        payload_json text not null,
        metadata_json text not null
      )
    `);
    database.run(`
      create unique index idx_orch_events_stream_version
      on orchestration_events(aggregate_kind, stream_id, stream_version)
    `);
  } finally {
    database.close();
  }
};

const createCursorGlobalStateDb = (dbPath: string): void => {
  const database = new Database(dbPath);

  try {
    database.run(
      "create table ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
    );
    database.run(
      "create table cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
    );
  } finally {
    database.close();
  }
};

const seedStalePokoCursorImport = async (): Promise<void> => {
  const database = new Database(cursorGlobalStateDbPath);

  try {
    const head = {
      type: "head",
      composerId: "stale-composer",
      name: "Old Poko import",
      lastUpdatedAt: Date.parse("2026-05-28T00:00:00.000Z"),
      pokoImport: {
        originator: "poko",
        projectRoot: await canonicalPath(cwd),
      },
    };
    database
      .query("insert or replace into ItemTable (key, value) values (?, ?)")
      .run(
        "composer.composerHeaders",
        JSON.stringify({ allComposers: [head] }),
      );
    database
      .query("insert or replace into cursorDiskKV (key, value) values (?, ?)")
      .run(
        "composerData:stale-composer",
        JSON.stringify({
          composerId: "stale-composer",
          pokoImport: {
            originator: "poko",
            projectRoot: await canonicalPath(cwd),
          },
        }),
      );
    database
      .query("insert or replace into cursorDiskKV (key, value) values (?, ?)")
      .run("bubbleId:stale-composer:old", JSON.stringify({ text: "stale" }));
  } finally {
    database.close();
  }
};

const createOpenCodeStateDb = (dbPath: string): void => {
  const database = new Database(dbPath);

  try {
    database.run(
      "create table session (id text primary key, version text, directory text)",
    );
    database.run("create table message (id text primary key, session_id text)");
    database.run("create table part (id text primary key, session_id text)");
  } finally {
    database.close();
  }
};

const seedStaleOpenCodeImport = async (dbPath: string): Promise<void> => {
  const database = new Database(dbPath);

  try {
    database
      .query("insert into session (id, version, directory) values (?, ?, ?)")
      .run("stale-opencode-session", "poko-import", await canonicalPath(cwd));
    database
      .query("insert into message (id, session_id) values (?, ?)")
      .run("stale-opencode-message", "stale-opencode-session");
    database
      .query("insert into part (id, session_id) values (?, ?)")
      .run("stale-opencode-part", "stale-opencode-session");
  } finally {
    database.close();
  }
};

const configureRepoHistoryStore = async (): Promise<void> => {
  const configPath = path.join(cwd, ".poko/poko.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    project?: { id?: string; createdAt?: string };
    history?: { defaultStore?: string };
  };
  config.project = {
    id: config.project?.id ?? "sync-test-project",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  config.history = {
    ...config.history,
    defaultStore: "repo",
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
};

const seedCodexSession = async (
  options: {
    projectRoot?: string;
    id?: string;
    title?: string;
    startedAt?: string;
  } = {},
): Promise<void> => {
  const sessionId = options.id ?? "sync-session";
  const startedAt = options.startedAt ?? "2026-05-29T00:00:00.000Z";
  const startedSlug = startedAt.replaceAll(":", "-").replace(".000Z", "");
  const sessionPath = path.join(
    codexHome,
    `sessions/2026/05/29/rollout-${startedSlug}-${sessionId}.jsonl`,
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        timestamp: "2026-05-29T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp: startedAt,
          cwd: options.projectRoot ?? cwd,
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-29T00:00:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "sync chats too" },
      }),
      JSON.stringify({
        timestamp: "2026-05-29T00:00:02.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "history synced" },
      }),
    ].join("\n"),
    "utf8",
  );
  await mkdir(codexHome, { recursive: true });
  await appendFile(
    path.join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({ id: sessionId, thread_name: options.title ?? "Sync history" })}\n`,
    "utf8",
  );
};

const seedCodexFeatureSession = async (): Promise<void> => {
  const sessionPath = path.join(
    codexHome,
    "sessions/2026/05/29/rollout-2026-05-29T00-10-00-feature-session.jsonl",
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        timestamp: "2026-05-29T00:10:00.000Z",
        type: "session_meta",
        payload: {
          id: "feature-session",
          timestamp: "2026-05-29T00:10:00.000Z",
          cwd,
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-29T00:10:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Feature fixture: inspect .poko/poko.json:45 and preserve clickable path text.",
            },
          ],
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-29T00:10:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: [
                "[thinking] inspect the project registry before editing",
                "Feature matrix response: file path, reasoning marker, and tool marker preserved.",
                "Tool result: schemaVersion=1",
              ].join("\n"),
            },
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: ".poko/poko.json:45" },
            },
          ],
        },
      }),
    ].join("\n"),
    "utf8",
  );
  await mkdir(codexHome, { recursive: true });
  await appendFile(
    path.join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({ id: "feature-session", thread_name: "Feature fixture" })}\n`,
    "utf8",
  );
};

const seedClaudeFeatureSession = async (): Promise<void> => {
  const sessionPath = path.join(
    claudeHome,
    "projects",
    encodeClaudePath(cwd),
    "00000000-0000-4000-8000-00000000f1a0.jsonl",
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: {
          role: "user",
          content:
            "Feature fixture: inspect .poko/poko.json:45 and preserve clickable path text.",
        },
        uuid: "00000000-0000-4000-8000-00000000f1a1",
        timestamp: "2026-05-29T00:10:01.000Z",
        userType: "external",
        entrypoint: "cli",
        cwd,
        sessionId: "00000000-0000-4000-8000-00000000f1a0",
        version: "2.1.156",
        gitBranch: "main",
      }),
      JSON.stringify({
        parentUuid: "00000000-0000-4000-8000-00000000f1a1",
        isSidechain: false,
        type: "assistant",
        message: {
          id: "msg_feature_claude",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            {
              type: "text",
              text: [
                "[thinking] inspect the project registry before editing",
                "Feature matrix response: file path, reasoning marker, and tool marker preserved.",
                "Tool result: schemaVersion=1",
              ].join("\n"),
            },
            {
              type: "tool_use",
              id: "toolu_feature_read",
              name: "Read",
              input: { file_path: ".poko/poko.json:45" },
            },
          ],
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
        uuid: "00000000-0000-4000-8000-00000000f1a2",
        timestamp: "2026-05-29T00:10:02.000Z",
        userType: "external",
        entrypoint: "cli",
        cwd,
        sessionId: "00000000-0000-4000-8000-00000000f1a0",
        version: "2.1.156",
        gitBranch: "main",
      }),
    ].join("\n"),
    "utf8",
  );
};

const seedClaudeSession = async (): Promise<void> => {
  const sessionPath = path.join(
    claudeHome,
    "projects",
    encodeClaudePath(cwd),
    "00000000-0000-4000-8000-000000000001.jsonl",
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: { role: "user", content: "Claude seed" },
        uuid: "00000000-0000-4000-8000-000000000002",
        timestamp: "2026-05-29T00:00:01.000Z",
        userType: "external",
        entrypoint: "cli",
        cwd,
        sessionId: "00000000-0000-4000-8000-000000000001",
        version: "2.1.156",
        gitBranch: "main",
      }),
      JSON.stringify({
        parentUuid: "00000000-0000-4000-8000-000000000002",
        isSidechain: false,
        type: "assistant",
        message: {
          id: "msg_seed",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "Claude answer" }],
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
        uuid: "00000000-0000-4000-8000-000000000003",
        timestamp: "2026-05-29T00:00:02.000Z",
        userType: "external",
        entrypoint: "cli",
        cwd,
        sessionId: "00000000-0000-4000-8000-000000000001",
        version: "2.1.156",
        gitBranch: "main",
      }),
    ].join("\n"),
    "utf8",
  );
};

const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort();
};

const encodeClaudePath = (projectRoot: string): string =>
  projectRoot.normalize("NFC").replace(/[^a-zA-Z0-9]/g, "-");

const encodePiPath = (projectRoot: string): string =>
  `--${path
    .resolve(projectRoot)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;

const seedStalePokoClaudeImport = async (projectDir: string): Promise<void> => {
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    path.join(projectDir, "00000000-0000-5000-8000-000000000999.jsonl"),
    [
      JSON.stringify({
        type: "custom-title",
        customTitle: "Old Poko import",
        sessionId: "00000000-0000-5000-8000-000000000999",
      }),
      JSON.stringify({
        type: "user",
        version: "poko-import",
        sessionId: "00000000-0000-5000-8000-000000000999",
        uuid: "00000000-0000-5000-8000-000000000998",
        message: { role: "user", content: "stale" },
      }),
    ].join("\n"),
    "utf8",
  );
};

const seedStalePokoPiImport = async (canonicalCwd: string): Promise<void> => {
  const stalePath = path.join(
    piHome,
    "sessions",
    encodePiPath(canonicalCwd),
    "2026-05-28T00-00-00-000Z_ses_stale.jsonl",
  );
  await mkdir(path.dirname(stalePath), { recursive: true });
  await writeFile(
    stalePath,
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "ses_stale",
        timestamp: "2026-05-28T00:00:00.000Z",
        cwd: canonicalCwd,
      }),
      JSON.stringify({
        type: "custom",
        id: "10000000",
        parentId: null,
        timestamp: "2026-05-28T00:00:00.000Z",
        customType: "poko.import",
        data: {
          originator: "poko",
          projectRoot: canonicalCwd,
        },
      }),
    ].join("\n"),
    "utf8",
  );
};

const seedStalePokoHermesImport = async (): Promise<void> => {
  const dbPath = path.join(hermesHome, "state.db");
  const database = new Database(dbPath);

  try {
    createHermesStateSchema(database);
    database
      .query(
        "insert into sessions (id, source, model_config, started_at, title) values (?, ?, ?, ?, ?)",
      )
      .run(
        "stale-hermes-session",
        "poko",
        JSON.stringify({
          pokoImport: {
            originator: "poko",
            projectRoot: await canonicalPath(cwd),
          },
        }),
        1,
        "Old Poko import",
      );
    database
      .query(
        "insert into messages (session_id, role, content, timestamp) values (?, ?, ?, ?)",
      )
      .run("stale-hermes-session", "user", "stale", 1);
  } finally {
    database.close();
  }
};

const createHermesStateSchema = (database: Database): void => {
  database.run(`
    create table if not exists schema_version (
      version integer not null
    )
  `);
  database.run(`
    create table if not exists sessions (
      id text primary key,
      source text not null,
      user_id text,
      model text,
      model_config text,
      system_prompt text,
      parent_session_id text,
      started_at real not null,
      ended_at real,
      end_reason text,
      message_count integer default 0,
      tool_call_count integer default 0,
      input_tokens integer default 0,
      output_tokens integer default 0,
      cache_read_tokens integer default 0,
      cache_write_tokens integer default 0,
      reasoning_tokens integer default 0,
      billing_provider text,
      billing_base_url text,
      billing_mode text,
      estimated_cost_usd real,
      actual_cost_usd real,
      cost_status text,
      cost_source text,
      pricing_version text,
      title text,
      api_call_count integer default 0,
      handoff_state text,
      handoff_platform text,
      handoff_error text
    )
  `);
  database.run(`
    create table if not exists messages (
      id integer primary key autoincrement,
      session_id text not null references sessions(id),
      role text not null,
      content text,
      tool_call_id text,
      tool_calls text,
      tool_name text,
      timestamp real not null,
      token_count integer,
      finish_reason text,
      reasoning text,
      reasoning_content text,
      reasoning_details text,
      codex_reasoning_items text,
      codex_message_items text,
      platform_message_id text,
      observed integer default 0
    )
  `);
};

const seedStalePokoOpenClawImport = async (
  canonicalCwd: string,
): Promise<void> => {
  const sessionDir = path.join(openClawStateDir, "agents", "main", "sessions");
  const stalePath = path.join(
    sessionDir,
    "2026-05-28T00-00-00-000Z_ses_stale.jsonl",
  );
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    stalePath,
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "ses_stale",
        timestamp: "2026-05-28T00:00:00.000Z",
        cwd: canonicalCwd,
      }),
      JSON.stringify({
        type: "custom",
        id: "10000000",
        parentId: null,
        timestamp: "2026-05-28T00:00:00.000Z",
        customType: "poko.import",
        data: {
          originator: "poko",
          projectRoot: canonicalCwd,
        },
      }),
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(sessionDir, "sessions.json"),
    `${JSON.stringify(
      {
        "poko:codex:stale": {
          sessionId: "ses_stale",
          updatedAt: Date.parse("2026-05-28T00:00:00.000Z"),
          sessionFile: path.basename(stalePath),
          displayName: "Old Poko import",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
};

const canonicalPath = async (projectRoot: string): Promise<string> => {
  try {
    return (await realpath(projectRoot)).normalize("NFC");
  } catch {
    return path.resolve(projectRoot).normalize("NFC");
  }
};

const createFakeOpenCodeBin = async (
  logPath: string,
  dbPath?: string,
): Promise<string> => {
  const scriptPath = path.join(cwd, "fake-opencode");
  await writeFile(
    scriptPath,
    [
      "#!/bin/sh",
      ...(dbPath
        ? [
            'if [ "$1" = "db" ] && [ "$2" = "path" ]; then',
            `  printf '%s\\n' ${shellQuote(dbPath)}`,
            "  exit 0",
            "fi",
          ]
        : []),
      `printf '%s %s\\n' "$1" "$2" >> ${shellQuote(logPath)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(scriptPath, 0o755);
  return scriptPath;
};

const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;
