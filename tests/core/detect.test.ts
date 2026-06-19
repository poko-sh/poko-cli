import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { claudeAdapter } from "../../src/adapters/claude.ts";
import { codexAdapter } from "../../src/adapters/codex.ts";
import { cursorAdapter } from "../../src/adapters/cursor.ts";
import { runInit } from "../../src/commands/init.ts";
import { createMemoryLogger, makeTempDir, removeTempDir } from "../helpers.ts";

let cwd: string;
let originalPath: string | undefined;

beforeEach(async () => {
  cwd = await makeTempDir();
  originalPath = process.env.PATH;
  process.env.PATH = path.dirname(process.execPath);
  await runInit({ cwd, logger: createMemoryLogger() });
});

afterEach(async () => {
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }

  await removeTempDir(cwd);
});

describe("agent detection", () => {
  test("detects Cursor from its global state database without PATH", async () => {
    const oldDbPath = process.env.POKO_CURSOR_GLOBAL_STATE_DB;
    const dbPath = path.join(cwd, "cursor-state.vscdb");

    try {
      await writeFile(dbPath, "", "utf8");
      process.env.POKO_CURSOR_GLOBAL_STATE_DB = dbPath;

      const detection = await cursorAdapter.detect(cwd);

      expect(detection.detected).toBe(true);
      expect(detection.reasons).toContain("found Cursor global state database");
    } finally {
      if (oldDbPath === undefined) {
        delete process.env.POKO_CURSOR_GLOBAL_STATE_DB;
      } else {
        process.env.POKO_CURSOR_GLOBAL_STATE_DB = oldDbPath;
      }
    }
  });

  test("detects Codex from its home directory without PATH", async () => {
    const oldCodexHome = process.env.CODEX_HOME;
    const codexHome = path.join(cwd, ".codex");

    try {
      await mkdir(codexHome, { recursive: true });
      process.env.CODEX_HOME = codexHome;

      const detection = await codexAdapter.detect(cwd);

      expect(detection.detected).toBe(true);
      expect(detection.reasons).toContain("found Codex home");
    } finally {
      if (oldCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = oldCodexHome;
      }
    }
  });

  test("detects Claude Code from its home directory without PATH", async () => {
    const oldClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const claudeHome = path.join(cwd, ".claude");

    try {
      await mkdir(claudeHome, { recursive: true });
      process.env.CLAUDE_CONFIG_DIR = claudeHome;

      const detection = await claudeAdapter.detect(cwd);

      expect(detection.detected).toBe(true);
      expect(detection.reasons).toContain("found Claude Code home");
    } finally {
      if (oldClaudeConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = oldClaudeConfigDir;
      }
    }
  });
});
