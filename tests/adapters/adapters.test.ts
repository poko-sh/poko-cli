import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { claudeAdapter } from "../../src/adapters/claude.ts";
import { codexAdapter } from "../../src/adapters/codex.ts";
import { cursorAdapter } from "../../src/adapters/cursor.ts";
import { hermesAdapter } from "../../src/adapters/hermes.ts";
import { openClawAdapter } from "../../src/adapters/openclaw.ts";
import { openCodeAdapter } from "../../src/adapters/opencode.ts";
import { piAdapter } from "../../src/adapters/pi.ts";
import { t3CodeAdapter } from "../../src/adapters/t3code.ts";
import { runInit } from "../../src/commands/init.ts";
import { loadPokoContext } from "../../src/core/config.ts";
import { createMemoryLogger, makeTempDir, removeTempDir } from "../helpers.ts";

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempDir();
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
  await mkdir(path.join(cwd, ".poko/skills/reviewer"), { recursive: true });
  await writeFile(
    path.join(cwd, ".poko/skills/reviewer/SKILL.md"),
    "---\nname: reviewer\ndescription: Review changes carefully.\n---\n\n# Reviewer\n",
    "utf8",
  );
});

afterEach(async () => {
  await removeTempDir(cwd);
});

describe("agent adapters", () => {
  test("renders Claude memory, MCP, and skills", async () => {
    const context = await loadPokoContext(cwd);
    const operations = claudeAdapter.render(context, {
      config: context.config,
    });

    expect(operations.map((operation) => operation.path)).toContain(
      "CLAUDE.md",
    );
    expect(operations.map((operation) => operation.path)).toContain(
      ".mcp.json",
    );
    expect(operations.map((operation) => operation.path)).toContain(
      ".claude/skills/reviewer/SKILL.md",
    );
  });

  test("renders Cursor MDC and MCP config", async () => {
    const context = await loadPokoContext(cwd);
    const operations = cursorAdapter.render(context, {
      config: context.config,
    });
    const rule = operations.find(
      (operation) => operation.path === ".cursor/rules/poko.mdc",
    );

    expect(rule?.type).toBe("replace");
    expect(rule && "content" in rule ? rule.content : "").toContain(
      "alwaysApply: true",
    );
    expect(operations.map((operation) => operation.path)).toContain(
      ".cursor/mcp.json",
    );
  });

  test("renders T3 Code AGENTS.md and skills", async () => {
    const context = await loadPokoContext(cwd);
    const operations = t3CodeAdapter.render(context, {
      config: context.config,
    });

    expect(operations.map((operation) => operation.path)).toContain(
      "AGENTS.md",
    );
    expect(operations.map((operation) => operation.path)).toContain(
      ".agents/skills/reviewer/SKILL.md",
    );
  });

  test("detects T3 Code from its native state database", async () => {
    const oldDbPath = process.env.POKO_T3CODE_DB_PATH;
    const dbPath = path.join(cwd, "state.sqlite");

    try {
      await writeFile(dbPath, "", "utf8");
      process.env.POKO_T3CODE_DB_PATH = dbPath;

      const detection = await t3CodeAdapter.detect(cwd);

      expect(detection.detected).toBe(true);
      expect(detection.reasons).toContain("found T3 Code state database");
    } finally {
      if (oldDbPath === undefined) {
        delete process.env.POKO_T3CODE_DB_PATH;
      } else {
        process.env.POKO_T3CODE_DB_PATH = oldDbPath;
      }
    }
  });

  test("renders Pi AGENTS.md and skills", async () => {
    const context = await loadPokoContext(cwd);
    const operations = piAdapter.render(context, {
      config: context.config,
    });

    expect(operations.map((operation) => operation.path)).toContain(
      "AGENTS.md",
    );
    expect(operations.map((operation) => operation.path)).toContain(
      ".pi/skills/reviewer/SKILL.md",
    );
  });

  test("renders Hermes AGENTS.md and portable skills", async () => {
    const context = await loadPokoContext(cwd);
    const operations = hermesAdapter.render(context, {
      config: context.config,
    });

    expect(operations.map((operation) => operation.path)).toContain(
      "AGENTS.md",
    );
    expect(operations.map((operation) => operation.path)).toContain(
      ".agents/skills/reviewer/SKILL.md",
    );
  });

  test("renders OpenClaw AGENTS.md and skills", async () => {
    const context = await loadPokoContext(cwd);
    const operations = openClawAdapter.render(context, {
      config: context.config,
    });

    expect(operations.map((operation) => operation.path)).toContain(
      "AGENTS.md",
    );
    expect(operations.map((operation) => operation.path)).toContain(
      ".agents/skills/reviewer/SKILL.md",
    );
  });

  test("renders OpenCode AGENTS.md and MCP config", async () => {
    const context = await loadPokoContext(cwd);
    const operations = openCodeAdapter.render(context, {
      config: context.config,
    });
    const mcp = operations.find(
      (operation) => operation.path === "opencode.json",
    );

    expect(operations.map((operation) => operation.path)).toContain(
      "AGENTS.md",
    );
    expect(mcp?.type).toBe("json-merge");
    expect(mcp && "merge" in mcp ? mcp.merge : {}).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        docs: {
          type: "remote",
          url: "https://example.com/mcp",
          enabled: true,
        },
      },
    });
    expect(mcp && "arrayUnion" in mcp ? mcp.arrayUnion : {}).toEqual({
      instructions: ["AGENTS.md"],
    });
  });

  test("renders Codex AGENTS.md and project MCP TOML", async () => {
    const context = await loadPokoContext(cwd);
    const operations = codexAdapter.render(context, { config: context.config });
    const toml = operations.find(
      (operation) => operation.path === ".codex/config.toml",
    );

    expect(operations.map((operation) => operation.path)).toContain(
      "AGENTS.md",
    );
    expect(toml && "content" in toml ? toml.content : "").toContain(
      "[mcp_servers.docs]",
    );
  });
});
