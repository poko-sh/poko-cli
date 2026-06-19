import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "../../src/cli.ts";
import { createMemoryLogger, makeTempDir, removeTempDir } from "../helpers.ts";

let claudeHome: string;
let oldClaudeConfigDir: string | undefined;

describe("poko restore", () => {
  test("requires native targets when restoring sessions", async () => {
    const cwd = await makeTempDir();

    try {
      await run(["init"], cwd, createMemoryLogger());
      const payloadPath = path.join(cwd, "restore.json");
      await writeFile(
        payloadPath,
        JSON.stringify({ sessions: [restoreSession()] }),
        "utf8",
      );
      const logger = createMemoryLogger();

      await expect(
        run(
          ["restore", "--file", payloadPath, "--store", "repo", "--json"],
          cwd,
          logger,
        ),
      ).rejects.toThrow("Restore requires native targets");
    } finally {
      await removeTempDir(cwd);
    }
  });

  test("imports raw sessions into repo history and claude native history", async () => {
    claudeHome = await makeTempDir();
    oldClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
    const cwd = await makeTempDir();

    try {
      await run(["init"], cwd, createMemoryLogger());
      const payloadPath = path.join(cwd, "restore.json");
      await writeFile(
        payloadPath,
        JSON.stringify({ sessions: [restoreSession()] }),
        "utf8",
      );
      const restoreLogger = createMemoryLogger();

      const code = await run(
        [
          "restore",
          "--file",
          payloadPath,
          "--store",
          "repo",
          "--targets",
          "claude",
          "--json",
        ],
        cwd,
        restoreLogger,
      );
      const report = JSON.parse(restoreLogger.messages.join("\n")) as {
        command: string;
        history: { sessions: Array<{ projectRoot: string }> };
      };

      expect(code).toBe(0);
      expect(report.command).toBe("restore");
      expect(report.history.sessions).toHaveLength(1);
      expect(report.history.sessions[0]?.projectRoot).toBe(cwd);

      const historyLogger = createMemoryLogger();
      await run(
        ["history", "--store", "repo", "--raw", "--json"],
        cwd,
        historyLogger,
      );
      const history = JSON.parse(historyLogger.messages.join("\n")) as {
        entries: Array<{ sourceAgent: string; title: string }>;
        sessions: Array<{ messages: unknown[] }>;
      };

      expect(history.entries).toEqual([
        expect.objectContaining({
          sourceAgent: "codex",
          title: "Restored chat",
        }),
      ]);
      expect(history.sessions[0]?.messages).toHaveLength(2);
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", oldClaudeConfigDir);
      await removeTempDir(claudeHome);
      await removeTempDir(cwd);
    }
  });

  test("previews selected native targets", async () => {
    const cwd = await makeTempDir();

    try {
      await run(["init"], cwd, createMemoryLogger());
      const payloadPath = path.join(cwd, "restore.json");
      await writeFile(
        payloadPath,
        JSON.stringify({ sessions: [restoreSession()] }),
        "utf8",
      );
      const logger = createMemoryLogger();

      await run(
        [
          "restore",
          "--file",
          payloadPath,
          "--targets",
          "claude,cursor",
          "--dry-run",
          "--json",
        ],
        cwd,
        logger,
      );
      const report = JSON.parse(logger.messages.join("\n")) as {
        agents: string[];
        history: {
          nativeTargets: Array<{ target: string; sessions: number }>;
        };
      };

      expect(report.agents).toEqual(["claude", "cursor"]);
      expect(report.history.nativeTargets).toEqual([
        expect.objectContaining({ target: "claude", sessions: 1 }),
        expect.objectContaining({ target: "cursor", sessions: 1 }),
      ]);
    } finally {
      await removeTempDir(cwd);
    }
  });
});

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
};

const restoreSession = () => ({
  schemaVersion: 1,
  id: "restore-session-1",
  sourceAgent: "codex",
  title: "Restored chat",
  projectRoot: "/old/machine/project",
  createdAt: "2026-05-30T10:00:00.000Z",
  updatedAt: "2026-05-30T10:02:00.000Z",
  messages: [
    {
      role: "user",
      text: "Please restore this.",
      timestamp: "2026-05-30T10:00:00.000Z",
    },
    {
      role: "assistant",
      text: "Restored.",
      timestamp: "2026-05-30T10:02:00.000Z",
    },
  ],
});
