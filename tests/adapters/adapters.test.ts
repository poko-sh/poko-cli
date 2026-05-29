import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { aiderAdapter } from "../../src/adapters/aider.ts";
import { antigravityAdapter } from "../../src/adapters/antigravity.ts";
import { claudeAdapter } from "../../src/adapters/claude.ts";
import { codexAdapter } from "../../src/adapters/codex.ts";
import { copilotAdapter } from "../../src/adapters/copilot.ts";
import { cursorAdapter } from "../../src/adapters/cursor.ts";
import { geminiAdapter } from "../../src/adapters/gemini.ts";
import { openCodeAdapter } from "../../src/adapters/opencode.ts";
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

  test("renders Aider conventions and read config", async () => {
    const context = await loadPokoContext(cwd);
    const operations = aiderAdapter.render(context, { config: context.config });

    expect(operations.map((operation) => operation.path)).toEqual([
      "CONVENTIONS.md",
      ".aider.conf.yml",
    ]);
  });

  test("renders Gemini context and workspace settings", async () => {
    const context = await loadPokoContext(cwd);
    const operations = geminiAdapter.render(context, {
      config: context.config,
    });

    expect(operations.map((operation) => operation.path)).toContain(
      "GEMINI.md",
    );
    expect(operations.map((operation) => operation.path)).toContain(
      ".gemini/settings.json",
    );
  });

  test("renders Antigravity GEMINI.md and workspace rule", async () => {
    const context = await loadPokoContext(cwd);
    const operations = antigravityAdapter.render(context, {
      config: context.config,
    });
    const rule = operations.find(
      (operation) => operation.path === ".agents/rules/poko.md",
    );

    expect(operations.map((operation) => operation.path)).toContain(
      "GEMINI.md",
    );
    expect(rule && "content" in rule ? rule.content : "").toContain(
      "alwaysApply: true",
    );
  });

  test("renders GitHub Copilot instructions and VS Code MCP", async () => {
    const context = await loadPokoContext(cwd);
    const operations = copilotAdapter.render(context, {
      config: context.config,
    });
    const mcp = operations.find(
      (operation) => operation.path === ".vscode/mcp.json",
    );

    expect(operations.map((operation) => operation.path)).toContain(
      ".github/copilot-instructions.md",
    );
    expect(mcp?.type).toBe("json-merge");
    expect(mcp && "merge" in mcp ? mcp.merge : {}).toEqual({
      servers: {
        docs: {
          type: "http",
          url: "https://example.com/mcp",
        },
      },
    });
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
