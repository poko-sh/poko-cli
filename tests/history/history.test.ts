import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCapture, runCaptureReport } from "../../src/commands/capture.ts";
import { runHandoff } from "../../src/commands/handoff.ts";
import { runHistory, runHistoryReport } from "../../src/commands/history.ts";
import { runInit } from "../../src/commands/init.ts";
import {
  loadHistoryIndex,
  loadHistorySessions,
} from "../../src/history/storage.ts";
import { createMemoryLogger, makeTempDir, removeTempDir } from "../helpers.ts";

let cwd: string;
let codexHome: string;
let claudeHome: string;
let cursorStorage: string;
let cursorGlobalStateDbPath: string;
let piHome: string;
let hermesHome: string;
let openClawStateDir: string;
let oldCodexHome: string | undefined;
let oldClaudeHome: string | undefined;
let oldClaudeConfigDir: string | undefined;
let oldCursorStorage: string | undefined;
let oldCursorGlobalStateDb: string | undefined;
let oldPiAgentDir: string | undefined;
let oldHermesHome: string | undefined;
let oldOpenClawStateDir: string | undefined;

beforeEach(async () => {
  cwd = await makeTempDir();
  codexHome = await makeTempDir();
  claudeHome = await makeTempDir();
  cursorStorage = await makeTempDir();
  cursorGlobalStateDbPath = path.join(await makeTempDir(), "state.vscdb");
  piHome = await makeTempDir();
  hermesHome = await makeTempDir();
  openClawStateDir = await makeTempDir();
  oldCodexHome = process.env.CODEX_HOME;
  oldClaudeHome = process.env.CLAUDE_HOME;
  oldClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  oldCursorStorage = process.env.POKO_CURSOR_STORAGE_ROOT;
  oldCursorGlobalStateDb = process.env.POKO_CURSOR_GLOBAL_STATE_DB;
  oldPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  oldHermesHome = process.env.HERMES_HOME;
  oldOpenClawStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_HOME = claudeHome;
  process.env.CLAUDE_CONFIG_DIR = claudeHome;
  process.env.POKO_CURSOR_STORAGE_ROOT = cursorStorage;
  process.env.POKO_CURSOR_GLOBAL_STATE_DB = cursorGlobalStateDbPath;
  process.env.PI_CODING_AGENT_DIR = piHome;
  process.env.HERMES_HOME = hermesHome;
  process.env.OPENCLAW_STATE_DIR = openClawStateDir;
  createCursorGlobalStateDb(cursorGlobalStateDbPath);
  await runInit({ cwd, logger: createMemoryLogger() });
  await setProjectCreatedAt("2026-01-01T00:00:00.000Z");
});

afterEach(async () => {
  restoreEnv("CODEX_HOME", oldCodexHome);
  restoreEnv("CLAUDE_HOME", oldClaudeHome);
  restoreEnv("CLAUDE_CONFIG_DIR", oldClaudeConfigDir);
  restoreEnv("POKO_CURSOR_STORAGE_ROOT", oldCursorStorage);
  restoreEnv("POKO_CURSOR_GLOBAL_STATE_DB", oldCursorGlobalStateDb);
  restoreEnv("PI_CODING_AGENT_DIR", oldPiAgentDir);
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
});

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
};

describe("history capture", () => {
  test("captures Codex JSONL sessions into repo history", async () => {
    await seedCodexSession();
    await seedCodexSession({
      id: "poko-imported-codex",
      title: "Poko imported Codex",
      userMessage: "should not echo",
      assistantMessage: "skip me",
      pokoImported: true,
    });
    await seedCodexSession({
      id: "codex-subagent",
      title: "Codex subagent",
      userMessage: "subagent task",
      assistantMessage: "subagent answer",
      subagent: true,
    });

    await runCapture({
      cwd,
      agent: "codex",
      store: "repo",
      logger: createMemoryLogger(),
    });

    const entries = await loadHistoryIndex(cwd, "repo");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourceAgent).toBe("codex");

    const sessions = await loadHistorySessions(cwd, "repo", 1);
    expect(sessions[0]?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(sessions[0]?.messages.map((message) => message.text)).toEqual([
      "implement capture",
      "capture implemented",
    ]);
  });

  test("shows dry-run session details", async () => {
    await seedCodexSession();
    const logger = createMemoryLogger();

    await runCapture({
      cwd,
      agent: "codex",
      store: "repo",
      dryRun: true,
      logger,
    });

    const output = logger.messages.join("\n");
    expect(output).toContain("would capture 1 Codex session");
    expect(output).toContain("- Codex test");
    expect(output).toContain("messages: 2");
    expect(output).toContain("source:");
  });

  test("includes live capture entries in JSON reports", async () => {
    await seedCodexSession();

    const report = await runCaptureReport({
      cwd,
      all: true,
      dryRun: true,
      logger: createMemoryLogger(),
      quiet: true,
    });

    expect(report.entries).toEqual([
      expect.objectContaining({
        sourceAgent: "codex",
        title: "Codex test",
        updatedAt: "2026-05-29T00:00:02.000Z",
        messageCount: 2,
      }),
    ]);
  });

  test("skips older same-path sessions from before .poko init", async () => {
    await setProjectCreatedAt("2026-05-28T00:00:00.000Z");
    await seedCodexSession({
      id: "old-session",
      title: "Old same-path project",
      day: "21",
      createdAt: "2026-05-21T00:00:00.000Z",
      userMessage: "old project idea",
      assistantMessage: "old answer",
    });
    await seedCodexSession();
    const logger = createMemoryLogger();

    await runCapture({
      cwd,
      agent: "codex",
      store: "repo",
      dryRun: true,
      logger,
    });

    const output = logger.messages.join("\n");
    expect(output).toContain("would capture 1 Codex session");
    expect(output).toContain("- Codex test");
    expect(output).toContain(
      "skipped 1 older same-path session(s) from before this .poko project was initialized",
    );
    expect(output).toContain("- skipped Old same-path project");

    const includePreviousLogger = createMemoryLogger();
    await runCapture({
      cwd,
      agent: "codex",
      store: "repo",
      dryRun: true,
      includePrevious: true,
      logger: includePreviousLogger,
    });
    expect(includePreviousLogger.messages.join("\n")).toContain(
      "would capture 2 Codex session",
    );
  });

  test("captures Claude project transcripts", async () => {
    await seedClaudeSession();
    await seedClaudeSession({
      sessionId: "poko-imported-claude",
      userMessage: "should not echo",
      assistantMessage: "skip me",
      version: "poko-import",
    });

    await runCapture({
      cwd,
      agent: "claude",
      store: "repo",
      logger: createMemoryLogger(),
    });

    const sessions = await loadHistorySessions(cwd, "repo", 1);
    expect(sessions[0]?.sourceAgent).toBe("claude");
    expect(sessions[0]?.messages[0]?.text).toBe("please fix this");
  });

  test("captures Cursor prompt history from workspace storage", async () => {
    await seedCursorWorkspace();

    await runCapture({
      cwd,
      agent: "cursor",
      store: "repo",
      logger: createMemoryLogger(),
    });

    const sessions = await loadHistorySessions(cwd, "repo", 1);
    expect(sessions[0]?.sourceAgent).toBe("cursor");
    expect(
      sessions[0]?.messages.some((message) => message.text === "fix types"),
    ).toBe(true);
  });

  test("captures Cursor native composer conversations", async () => {
    await seedCursorNativeConversation();

    await runCapture({
      cwd,
      agent: "cursor",
      store: "repo",
      logger: createMemoryLogger(),
    });

    const sessions = await loadHistorySessions(cwd, "repo", 1);
    expect(sessions[0]?.sourceAgent).toBe("cursor");
    expect(sessions[0]?.title).toBe("Cursor native");
    expect(sessions[0]?.messages.map((message) => message.text)).toEqual([
      "ask cursor",
      "answer cursor",
    ]);
  });

  test("skips Cursor Poko imports during capture", async () => {
    await seedCursorPokoImportConversation();

    const logger = createMemoryLogger();
    const captured = await runCapture({
      cwd,
      agent: "cursor",
      store: "repo",
      logger,
    });

    expect(captured).toBe(0);
    expect(logger.messages.join("\n")).toContain("no matching history found");
  });

  test("captures Pi JSONL sessions", async () => {
    await seedPiSession();
    await seedPiSession({
      id: "poko-imported-pi",
      title: "Poko imported Pi",
      userMessage: "should not echo",
      assistantMessage: "skip me",
      pokoImported: true,
    });

    await runCapture({
      cwd,
      agent: "pi",
      store: "repo",
      logger: createMemoryLogger(),
    });

    const sessions = await loadHistorySessions(cwd, "repo", 1);
    expect(sessions[0]?.sourceAgent).toBe("pi");
    expect(sessions[0]?.title).toBe("Pi seed");
    expect(sessions[0]?.messages.map((message) => message.text)).toEqual([
      "ask pi",
      "answer pi",
    ]);
  });

  test("captures Hermes SQLite sessions", async () => {
    await seedHermesSession();
    await seedHermesSession({
      id: "poko-imported-hermes",
      title: "Poko imported Hermes",
      userMessage: "should not echo",
      assistantMessage: "skip me",
      pokoImported: true,
    });

    await runCapture({
      cwd,
      agent: "hermes",
      store: "repo",
      logger: createMemoryLogger(),
    });

    const sessions = await loadHistorySessions(cwd, "repo", 1);
    expect(sessions[0]?.sourceAgent).toBe("hermes");
    expect(sessions[0]?.title).toBe("Hermes seed");
    expect(sessions[0]?.messages.map((message) => message.text)).toEqual([
      "ask hermes",
      "answer hermes",
    ]);
  });

  test("captures OpenClaw JSONL sessions", async () => {
    await seedOpenClawSession();
    await seedOpenClawSession({
      id: "poko-imported-openclaw",
      title: "Poko imported OpenClaw",
      userMessage: "should not echo",
      assistantMessage: "skip me",
      pokoImported: true,
    });

    await runCapture({
      cwd,
      agent: "openclaw",
      store: "repo",
      logger: createMemoryLogger(),
    });

    const sessions = await loadHistorySessions(cwd, "repo", 1);
    expect(sessions[0]?.sourceAgent).toBe("openclaw");
    expect(sessions[0]?.title).toBe("OpenClaw seed");
    expect(sessions[0]?.messages.map((message) => message.text)).toEqual([
      "ask openclaw",
      "answer openclaw",
    ]);
  });

  test("lists history and renders a handoff", async () => {
    await seedCodexSession();
    await runCapture({
      cwd,
      agent: "codex",
      store: "repo",
      logger: createMemoryLogger(),
    });

    const historyLogger = createMemoryLogger();
    const count = await runHistory({
      cwd,
      store: "repo",
      logger: historyLogger,
    });
    expect(count).toBe(1);
    expect(historyLogger.messages.join("\n")).toContain("Codex test");

    const handoff = await runHandoff({
      cwd,
      agent: "cursor",
      store: "repo",
      stdout: true,
      logger: createMemoryLogger(),
    });
    expect(handoff).toContain("Poko Handoff for cursor");
    expect(handoff).toContain("implement capture");

    const fileHandoff = await runHandoff({
      cwd,
      agent: "claude",
      store: "repo",
      logger: createMemoryLogger(),
    });
    expect(fileHandoff).toContain("Poko Handoff for claude");
    expect(
      await readFile(path.join(cwd, ".poko/handoffs/claude-latest.md"), "utf8"),
    ).toContain("Codex test");
  });

  test("can include raw sessions in history JSON reports", async () => {
    await seedCodexSession();
    await runCapture({
      cwd,
      agent: "codex",
      store: "repo",
      logger: createMemoryLogger(),
    });

    const report = await runHistoryReport({
      cwd,
      store: "repo",
      raw: true,
      limit: "1",
      logger: createMemoryLogger(),
    });

    expect(report.entries).toHaveLength(1);
    expect(report.sessions).toHaveLength(1);
    expect(report.sessions?.[0]?.title).toBe("Codex test");
    expect(
      report.sessions?.[0]?.messages.map((message) => message.text),
    ).toEqual(["implement capture", "capture implemented"]);
  });
});

const setProjectCreatedAt = async (createdAt: string): Promise<void> => {
  const configPath = path.join(cwd, ".poko/poko.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    project?: { id?: string; createdAt?: string };
  };
  config.project = {
    id: config.project?.id ?? "test-project",
    createdAt,
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
};

const seedCodexSession = async (
  options: {
    id?: string;
    title?: string;
    day?: string;
    createdAt?: string;
    userMessage?: string;
    assistantMessage?: string;
    pokoImported?: boolean;
    subagent?: boolean;
  } = {},
): Promise<void> => {
  const id = options.id ?? "session-1";
  const day = options.day ?? "29";
  const createdAt = options.createdAt ?? "2026-05-29T00:00:00.000Z";
  const userTimestamp = addSeconds(createdAt, 1);
  const assistantTimestamp = addSeconds(createdAt, 2);
  const sessionPath = path.join(
    codexHome,
    `sessions/2026/05/${day}/rollout-${createdAt.replaceAll(":", "-")}-${id}.jsonl`,
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        timestamp: createdAt,
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "developer instructions" }],
        },
      }),
      JSON.stringify({
        timestamp: createdAt,
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "<subagent_notification>{}</subagent_notification>",
        },
      }),
      JSON.stringify({
        timestamp: createdAt,
        type: "session_meta",
        payload: {
          id,
          timestamp: createdAt,
          cwd,
          ...(options.pokoImported
            ? { originator: "poko", cli_version: "poko-import" }
            : {}),
          ...(options.subagent
            ? {
                thread_source: "subagent",
                source: {
                  subagent: {
                    thread_spawn: {
                      parent_thread_id: "parent-thread",
                      depth: 1,
                    },
                  },
                },
              }
            : {}),
        },
      }),
      JSON.stringify({
        timestamp: userTimestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: options.userMessage ?? "implement capture",
            },
          ],
        },
      }),
      JSON.stringify({
        timestamp: userTimestamp,
        type: "event_msg",
        payload: {
          type: "user_message",
          message: options.userMessage ?? "implement capture",
        },
      }),
      JSON.stringify({
        timestamp: assistantTimestamp,
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: options.assistantMessage ?? "capture implemented",
        },
      }),
      JSON.stringify({
        timestamp: assistantTimestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: options.assistantMessage ?? "capture implemented",
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
    `${JSON.stringify({ id, thread_name: options.title ?? "Codex test" })}\n`,
    "utf8",
  );
};

const addSeconds = (timestamp: string, seconds: number): string =>
  new Date(Date.parse(timestamp) + seconds * 1000).toISOString();

const seedClaudeSession = async (
  options: {
    sessionId?: string;
    userMessage?: string;
    assistantMessage?: string;
    version?: string;
  } = {},
): Promise<void> => {
  const sessionId = options.sessionId ?? "claude-session";
  const projectDir = path.join(
    claudeHome,
    "projects",
    cwd.replaceAll("/", "-"),
  );
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    path.join(projectDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        cwd,
        sessionId,
        type: "user",
        message: {
          role: "user",
          content: options.userMessage ?? "please fix this",
        },
        timestamp: "2026-05-29T00:00:01.000Z",
        uuid: "u1",
        ...(options.version ? { version: options.version } : {}),
      }),
      JSON.stringify({
        cwd,
        sessionId,
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: options.assistantMessage ?? "fixed it" },
          ],
        },
        timestamp: "2026-05-29T00:00:02.000Z",
        uuid: "a1",
        ...(options.version ? { version: options.version } : {}),
      }),
    ].join("\n"),
    "utf8",
  );
};

const seedCursorWorkspace = async (): Promise<void> => {
  const workspaceDir = path.join(cursorStorage, "workspace-1");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(
    path.join(workspaceDir, "workspace.json"),
    JSON.stringify({ folder: pathToFileURL(cwd).href }),
    "utf8",
  );
  const database = new Database(path.join(workspaceDir, "state.vscdb"));
  database.run(
    "create table ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
  );
  database
    .query("insert into ItemTable (key, value) values (?, ?)")
    .run(
      "aiService.prompts",
      JSON.stringify([{ text: "fix types", commandType: 4 }]),
    );
  database.query("insert into ItemTable (key, value) values (?, ?)").run(
    "composer.composerData",
    JSON.stringify({
      allComposers: [
        {
          composerId: "composer-1",
          name: "Types fix",
          lastUpdatedAt: Date.parse("2026-05-29T00:00:02.000Z"),
        },
      ],
    }),
  );
  database.close();
};

const seedCursorNativeConversation = async (): Promise<void> => {
  await seedCursorWorkspace();
  const workspaceDir = path.join(cursorStorage, "workspace-1");
  const workspaceDatabase = new Database(
    path.join(workspaceDir, "state.vscdb"),
  );
  const globalDatabase = new Database(cursorGlobalStateDbPath);
  const composerId = "00000000-0000-4000-8000-000000000101";
  const userBubbleId = "00000000-0000-4000-8000-000000000102";
  const assistantBubbleId = "00000000-0000-4000-8000-000000000103";

  try {
    workspaceDatabase
      .query("insert into ItemTable (key, value) values (?, ?)")
      .run(
        "composer.composerData",
        JSON.stringify({
          allComposers: [
            {
              type: "head",
              composerId,
              name: "Cursor native",
              createdAt: Date.parse("2026-05-29T00:00:00.000Z"),
              lastUpdatedAt: Date.parse("2026-05-29T00:00:02.000Z"),
            },
          ],
        }),
      );
    globalDatabase
      .query("insert into cursorDiskKV (key, value) values (?, ?)")
      .run(
        `composerData:${composerId}`,
        JSON.stringify({
          composerId,
          name: "Cursor native",
          createdAt: Date.parse("2026-05-29T00:00:00.000Z"),
          lastUpdatedAt: Date.parse("2026-05-29T00:00:02.000Z"),
          fullConversationHeadersOnly: [
            { bubbleId: userBubbleId, type: 1 },
            { bubbleId: assistantBubbleId, type: 2 },
          ],
        }),
      );
    globalDatabase
      .query("insert into cursorDiskKV (key, value) values (?, ?)")
      .run(
        `bubbleId:${composerId}:${userBubbleId}`,
        JSON.stringify({
          type: 1,
          bubbleId: userBubbleId,
          text: "ask cursor",
          createdAt: "2026-05-29T00:00:01.000Z",
        }),
      );
    globalDatabase
      .query("insert into cursorDiskKV (key, value) values (?, ?)")
      .run(
        `bubbleId:${composerId}:${assistantBubbleId}`,
        JSON.stringify({
          type: 2,
          bubbleId: assistantBubbleId,
          text: "answer cursor",
          createdAt: "2026-05-29T00:00:02.000Z",
        }),
      );
  } finally {
    workspaceDatabase.close();
    globalDatabase.close();
  }
};

const seedCursorPokoImportConversation = async (): Promise<void> => {
  await seedCursorWorkspace();
  const workspaceDir = path.join(cursorStorage, "workspace-1");
  const workspaceDatabase = new Database(
    path.join(workspaceDir, "state.vscdb"),
  );
  const globalDatabase = new Database(cursorGlobalStateDbPath);
  const composerId = "00000000-0000-4000-8000-000000000201";
  const userBubbleId = "00000000-0000-4000-8000-000000000202";
  const assistantBubbleId = "00000000-0000-4000-8000-000000000203";
  const pokoImport = {
    originator: "poko",
    sourceAgent: "codex",
    sourceSessionId: "codex-source",
    lineageId: "codex:codex-source",
    projectId: "project-source",
    projectRoot: cwd,
  };

  try {
    workspaceDatabase
      .query("insert into ItemTable (key, value) values (?, ?)")
      .run(
        "composer.composerData",
        JSON.stringify({
          allComposers: [
            {
              type: "head",
              composerId,
              name: "Cursor imported",
              createdAt: Date.parse("2026-05-29T00:00:00.000Z"),
              lastUpdatedAt: Date.parse("2026-05-29T00:00:02.000Z"),
              pokoImport,
            },
          ],
        }),
      );
    globalDatabase
      .query("insert into cursorDiskKV (key, value) values (?, ?)")
      .run(
        `composerData:${composerId}`,
        JSON.stringify({
          composerId,
          name: "Cursor imported",
          createdAt: Date.parse("2026-05-29T00:00:00.000Z"),
          lastUpdatedAt: Date.parse("2026-05-29T00:00:02.000Z"),
          pokoImport,
          fullConversationHeadersOnly: [
            { bubbleId: userBubbleId, type: 1 },
            { bubbleId: assistantBubbleId, type: 2 },
          ],
        }),
      );
    globalDatabase
      .query("insert into cursorDiskKV (key, value) values (?, ?)")
      .run(
        `bubbleId:${composerId}:${userBubbleId}`,
        JSON.stringify({
          type: 1,
          bubbleId: userBubbleId,
          text: "ask cursor",
          createdAt: "2026-05-29T00:00:01.000Z",
          pokoImport,
        }),
      );
    globalDatabase
      .query("insert into cursorDiskKV (key, value) values (?, ?)")
      .run(
        `bubbleId:${composerId}:${assistantBubbleId}`,
        JSON.stringify({
          type: 2,
          bubbleId: assistantBubbleId,
          text: "answer cursor",
          createdAt: "2026-05-29T00:00:02.000Z",
          pokoImport,
        }),
      );
  } finally {
    workspaceDatabase.close();
    globalDatabase.close();
  }
};

const seedPiSession = async (
  options: {
    id?: string;
    title?: string;
    userMessage?: string;
    assistantMessage?: string;
    pokoImported?: boolean;
  } = {},
): Promise<void> => {
  const id = options.id ?? "pi-session";
  const sessionPath = path.join(
    piHome,
    "sessions",
    encodePiPath(cwd),
    `2026-05-29T00-00-00-000Z_${id}.jsonl`,
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id,
        timestamp: "2026-05-29T00:00:00.000Z",
        cwd,
      }),
      ...(options.pokoImported
        ? [
            JSON.stringify({
              type: "custom",
              id: "10000000",
              parentId: null,
              timestamp: "2026-05-29T00:00:00.000Z",
              customType: "poko.import",
              data: {
                originator: "poko",
                projectRoot: cwd,
              },
            }),
          ]
        : []),
      JSON.stringify({
        type: "session_info",
        id: "20000000",
        parentId: options.pokoImported ? "10000000" : null,
        timestamp: "2026-05-29T00:00:00.000Z",
        name: options.title ?? "Pi seed",
      }),
      JSON.stringify({
        type: "message",
        id: "30000000",
        parentId: "20000000",
        timestamp: "2026-05-29T00:00:01.000Z",
        message: {
          role: "user",
          content: options.userMessage ?? "ask pi",
          timestamp: Date.parse("2026-05-29T00:00:01.000Z"),
        },
      }),
      JSON.stringify({
        type: "message",
        id: "40000000",
        parentId: "30000000",
        timestamp: "2026-05-29T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: options.assistantMessage ?? "answer pi" },
          ],
          api: "test",
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          usage: {},
          stopReason: "stop",
          timestamp: Date.parse("2026-05-29T00:00:02.000Z"),
        },
      }),
    ].join("\n"),
    "utf8",
  );
};

const seedHermesSession = async (
  options: {
    id?: string;
    title?: string;
    userMessage?: string;
    assistantMessage?: string;
    pokoImported?: boolean;
  } = {},
): Promise<void> => {
  const id = options.id ?? "hermes-session";
  const database = new Database(path.join(hermesHome, "state.db"));

  try {
    createHermesStateSchema(database);
    database
      .query(
        `insert into sessions (
          id, source, model_config, system_prompt, started_at, ended_at,
          title, message_count
        ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        options.pokoImported ? "poko" : "cli",
        options.pokoImported
          ? JSON.stringify({
              pokoImport: { originator: "poko", projectRoot: cwd },
            })
          : null,
        `Current working directory: ${cwd}`,
        Date.parse("2026-05-29T00:00:00.000Z") / 1000,
        Date.parse("2026-05-29T00:00:02.000Z") / 1000,
        options.title ?? "Hermes seed",
        2,
      );
    database
      .query(
        "insert into messages (session_id, role, content, timestamp) values (?, ?, ?, ?)",
      )
      .run(
        id,
        "user",
        options.userMessage ?? "ask hermes",
        Date.parse("2026-05-29T00:00:01.000Z") / 1000,
      );
    database
      .query(
        "insert into messages (session_id, role, content, timestamp) values (?, ?, ?, ?)",
      )
      .run(
        id,
        "assistant",
        options.assistantMessage ?? "answer hermes",
        Date.parse("2026-05-29T00:00:02.000Z") / 1000,
      );
  } finally {
    database.close();
  }
};

const createHermesStateSchema = (database: Database): void => {
  database.run(`
    create table if not exists sessions (
      id text primary key,
      source text not null,
      model text,
      model_config text,
      system_prompt text,
      started_at real not null,
      ended_at real,
      title text,
      message_count integer default 0
    )
  `);
  database.run(`
    create table if not exists messages (
      id integer primary key autoincrement,
      session_id text not null,
      role text not null,
      content text,
      timestamp real not null
    )
  `);
};

const seedOpenClawSession = async (
  options: {
    id?: string;
    title?: string;
    userMessage?: string;
    assistantMessage?: string;
    pokoImported?: boolean;
  } = {},
): Promise<void> => {
  const id = options.id ?? "openclaw-session";
  const sessionPath = path.join(
    openClawStateDir,
    "agents",
    "main",
    "sessions",
    `2026-05-29T00-00-00-000Z_${id}.jsonl`,
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id,
        timestamp: "2026-05-29T00:00:00.000Z",
        cwd,
      }),
      ...(options.pokoImported
        ? [
            JSON.stringify({
              type: "custom",
              id: "10000000",
              parentId: null,
              timestamp: "2026-05-29T00:00:00.000Z",
              customType: "poko.import",
              data: {
                originator: "poko",
                projectRoot: cwd,
              },
            }),
          ]
        : []),
      JSON.stringify({
        type: "session_info",
        id: "20000000",
        parentId: options.pokoImported ? "10000000" : null,
        timestamp: "2026-05-29T00:00:00.000Z",
        name: options.title ?? "OpenClaw seed",
      }),
      JSON.stringify({
        type: "message",
        id: "30000000",
        parentId: "20000000",
        timestamp: "2026-05-29T00:00:01.000Z",
        message: {
          role: "user",
          content: options.userMessage ?? "ask openclaw",
        },
      }),
      JSON.stringify({
        type: "message",
        id: "40000000",
        parentId: "30000000",
        timestamp: "2026-05-29T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: options.assistantMessage ?? "answer openclaw",
            },
          ],
        },
      }),
    ].join("\n"),
    "utf8",
  );
};

const encodePiPath = (projectRoot: string): string =>
  `--${path
    .resolve(projectRoot)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;

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
