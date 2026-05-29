import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { runExport } from "../../src/commands/export.ts";
import { runInit } from "../../src/commands/init.ts";
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
});

afterEach(async () => {
  await removeTempDir(cwd);
});

describe("poko export", () => {
  test("prints a specific agent export to stdout", async () => {
    const logger = createMemoryLogger();
    const output = await runExport({
      cwd,
      agent: "cursor",
      stdout: true,
      logger,
    });

    expect(output).toContain("# .cursor/rules/poko.mdc");
    expect(output).toContain("Cursor Project Context");
    expect(output).not.toContain("Add durable instructions");
    expect(logger.messages.join("\n")).toContain(".cursor/rules/poko.mdc");
  });

  test("rejects unknown agents", async () => {
    await expect(
      runExport({
        cwd,
        agent: "unknown",
        stdout: true,
        logger: createMemoryLogger(),
      }),
    ).rejects.toThrow("Unknown agent");
  });

  test("prints OpenCode array union config accurately", async () => {
    const output = await runExport({
      cwd,
      agent: "oc",
      stdout: true,
      logger: createMemoryLogger(),
    });

    expect(output).toContain("# opencode.json");
    expect(output).toContain('"instructions": ["AGENTS.md"]');
  });
});
