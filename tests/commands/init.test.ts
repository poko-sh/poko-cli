import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { createMemoryLogger, makeTempDir, removeTempDir } from "../helpers.ts";

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(cwd);
});

describe("poko init", () => {
  test("creates only the Poko registry config", async () => {
    const logger = createMemoryLogger();
    const results = await runInit({ cwd, logger });

    expect(results.every((result) => result.action === "created")).toBe(true);
    expect(results.map((result) => result.path)).toEqual([".poko/poko.json"]);
    const config = JSON.parse(
      await readFile(path.join(cwd, ".poko/poko.json"), "utf8"),
    ) as {
      schemaVersion: number;
      adapters: Record<string, { enabled: boolean }>;
      history: { agents: Record<string, boolean> };
    };
    expect(config.schemaVersion).toBe(1);
    expect(config.adapters.codex?.enabled).toBe(true);
    expect(config.adapters.claude?.enabled).toBe(true);
    expect(config.adapters.cursor?.enabled).toBe(false);
    expect(config.adapters.opencode?.enabled).toBe(false);
    expect(config.adapters.pi?.enabled).toBe(false);
    expect(config.history.agents.codex).toBe(true);
    expect(config.history.agents.claude).toBe(true);
    expect(config.history.agents.cursor).toBe(false);
    expect(await Bun.file(path.join(cwd, ".poko/rules.md")).exists()).toBe(
      false,
    );
    expect(await Bun.file(path.join(cwd, ".poko/mcp.json")).exists()).toBe(
      false,
    );
    expect(
      await Bun.file(path.join(cwd, ".poko/skills/README.md")).exists(),
    ).toBe(false);
  });

  test("does not overwrite existing files unless forced", async () => {
    await runInit({ cwd, logger: createMemoryLogger() });
    const original = await readFile(path.join(cwd, ".poko/poko.json"), "utf8");

    const skipped = await runInit({ cwd, logger: createMemoryLogger() });
    expect(
      skipped.find((result) => result.path === ".poko/poko.json")?.action,
    ).toBe("skipped");
    expect(await readFile(path.join(cwd, ".poko/poko.json"), "utf8")).toBe(
      original,
    );

    const forced = await runInit({
      cwd,
      force: true,
      logger: createMemoryLogger(),
    });
    expect(
      forced.find((result) => result.path === ".poko/poko.json")?.action,
    ).toBe("overwritten");
    expect(await readFile(path.join(cwd, ".poko/poko.json"), "utf8")).toContain(
      '"schemaVersion": 1',
    );
  });
});
