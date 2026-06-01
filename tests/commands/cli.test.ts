import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { run } from "../../src/cli.ts";
import { createMemoryLogger, makeTempDir, removeTempDir } from "../helpers.ts";

describe("cli", () => {
  test("shows global help for --help", async () => {
    const logger = createMemoryLogger();
    const code = await run(["--help"], process.cwd(), logger);

    expect(code).toBe(0);
    expect(logger.messages.join("\n")).toContain("poko init");
    expect(logger.messages.join("\n")).toContain("poko sync --global");
  });

  test("shows command help for doctor --help", async () => {
    const logger = createMemoryLogger();
    const code = await run(["doctor", "--help"], process.cwd(), logger);

    expect(code).toBe(0);
    expect(logger.messages.join("\n")).toContain("poko doctor");
    expect(logger.messages.join("\n")).toContain("native sync dry-run");
  });

  test("shows command help for status --help", async () => {
    const logger = createMemoryLogger();
    const code = await run(["status", "--help"], process.cwd(), logger);

    expect(code).toBe(0);
    expect(logger.messages.join("\n")).toContain("poko status");
    expect(logger.messages.join("\n")).toContain("compact readiness summary");
  });

  test("prints JSON for uninitialized status", async () => {
    const cwd = await makeTempDir();
    const logger = createMemoryLogger();

    try {
      const code = await run(["status", "--json"], cwd, logger);
      const parsed = JSON.parse(logger.messages.join("\n")) as {
        command: string;
        initialized: boolean;
      };

      expect(code).toBe(0);
      expect(parsed.command).toBe("status");
      expect(parsed.initialized).toBe(false);
    } finally {
      await removeTempDir(cwd);
    }
  });

  test("hides email-like values when private display is enabled", async () => {
    const tempRoot = await makeTempDir();
    const cwd = path.join(tempRoot, "fraser@example.com", "project");
    const logger = createMemoryLogger();

    try {
      await mkdir(cwd, { recursive: true });
      const code = await run(
        ["status", "--json", "--private-display"],
        cwd,
        logger,
      );
      const output = logger.messages.join("\n");
      const parsed = JSON.parse(output) as { root: string };

      expect(code).toBe(0);
      expect(output).not.toContain("fraser@example.com");
      expect(parsed.root).toContain("[hidden email]");
    } finally {
      await removeTempDir(tempRoot);
    }
  });

  test("returns an error for unknown commands", async () => {
    await expect(
      run(["nope"], process.cwd(), createMemoryLogger()),
    ).rejects.toThrow("Unknown command");
  });

  test("hides email-like values in thrown errors when private display is enabled", async () => {
    await expect(
      run(
        ["export", "fraser@example.com", "--private-display"],
        process.cwd(),
        createMemoryLogger(),
      ),
    ).rejects.toThrow("[hidden email]");
  });
});
