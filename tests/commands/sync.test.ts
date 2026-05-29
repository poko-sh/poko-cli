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
import { runSync } from "../../src/commands/sync.ts";
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
  test("syncs every enabled adapter on --all", async () => {
    const results = await runSync({
      cwd,
      all: true,
      dryRun: true,
      logger: createMemoryLogger(),
    });

    const paths = results.map((result) => result.path);
    expect(paths).toContain("GEMINI.md");
    expect(paths).toContain(".agents/rules/poko.md");
    expect(paths).toContain(".github/copilot-instructions.md");
    expect(paths).toContain(".vscode/mcp.json");
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain("opencode.json");
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
    expect(rows.map((row) => row.type)).toEqual([
      "session_meta",
      "response_item",
      "event_msg",
      "response_item",
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
      expect(headers.allComposers).toHaveLength(1);
      expect(headers.allComposers[0]?.name).toBe("Sync history");
      expect(headers.allComposers[0]?.composerId).not.toBe("stale-composer");

      const composerId = headers.allComposers[0]?.composerId ?? "";
      const composer = JSON.parse(
        String(
          (
            database
              .query("select value from cursorDiskKV where key = ?")
              .get(`composerData:${composerId}`) as { value: string }
          ).value,
        ),
      ) as {
        modelConfig: { modelName: string };
        pokoImport: { originator: string };
        fullConversationHeadersOnly: Array<{ bubbleId: string; type: number }>;
      };
      expect(composer.modelConfig.modelName).toBe("composer-2.5");
      expect(composer.pokoImport.originator).toBe("poko");
      expect(
        composer.fullConversationHeadersOnly.map((head) => head.type),
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
    database.run(`
      create table projection_projects (
        project_id text primary key,
        title text not null,
        workspace_root text not null,
        scripts_json text not null,
        created_at text not null,
        updated_at text not null,
        deleted_at text,
        default_model_selection_json text
      )
    `);
    database.run(`
      create table projection_threads (
        thread_id text primary key,
        project_id text not null,
        title text not null,
        branch text,
        worktree_path text,
        latest_turn_id text,
        created_at text not null,
        updated_at text not null,
        deleted_at text,
        runtime_mode text not null default 'full-access',
        interaction_mode text not null default 'default',
        model_selection_json text,
        archived_at text,
        latest_user_message_at text,
        pending_approval_count integer not null default 0,
        pending_user_input_count integer not null default 0,
        has_actionable_proposed_plan integer not null default 0
      )
    `);
    database.run(`
      create table projection_thread_messages (
        message_id text primary key,
        thread_id text not null,
        turn_id text,
        role text not null,
        text text not null,
        is_streaming integer not null,
        created_at text not null,
        updated_at text not null,
        attachments_json text
      )
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

const seedCodexSession = async (): Promise<void> => {
  const sessionPath = path.join(
    codexHome,
    "sessions/2026/05/29/rollout-2026-05-29T00-00-00-sync-session.jsonl",
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        timestamp: "2026-05-29T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "sync-session",
          timestamp: "2026-05-29T00:00:00.000Z",
          cwd,
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
    `${JSON.stringify({ id: "sync-session", thread_name: "Sync history" })}\n`,
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
