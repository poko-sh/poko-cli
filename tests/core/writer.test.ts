import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyWritePlan } from "../../src/core/writer.ts";
import { makeTempDir, removeTempDir } from "../helpers.ts";

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(cwd);
});

describe("writer", () => {
  test("adds and replaces managed blocks while preserving manual content", async () => {
    const target = path.join(cwd, "AGENTS.md");
    await writeFile(target, "# Manual\n\nKeep me.\n", "utf8");

    await applyWritePlan(cwd, [
      {
        type: "managed-block",
        path: "AGENTS.md",
        content: "first",
        marker: "poko",
        commentStyle: "html",
        label: "test",
      },
    ]);

    await applyWritePlan(cwd, [
      {
        type: "managed-block",
        path: "AGENTS.md",
        content: "second",
        marker: "poko",
        commentStyle: "html",
        label: "test",
      },
    ]);

    const content = await readFile(target, "utf8");
    expect(content).toContain("# Manual");
    expect(content).toContain("Keep me.");
    expect(content).toContain("second");
    expect(content).not.toContain("first");
  });

  test("deep merges JSON configs", async () => {
    await writeFile(
      path.join(cwd, ".cursor.json"),
      JSON.stringify({
        mcpServers: { existing: { url: "https://example.com" } },
      }),
      "utf8",
    );

    await applyWritePlan(cwd, [
      {
        type: "json-merge",
        path: ".cursor.json",
        merge: { mcpServers: { poko: { command: "bun" } } },
        label: "json",
      },
    ]);

    const merged = JSON.parse(
      await readFile(path.join(cwd, ".cursor.json"), "utf8"),
    );
    expect(merged.mcpServers.existing.url).toBe("https://example.com");
    expect(merged.mcpServers.poko.command).toBe("bun");
  });

  test("can union JSON string arrays while merging", async () => {
    await writeFile(
      path.join(cwd, "opencode.json"),
      JSON.stringify({ instructions: ["CONTRIBUTING.md"], theme: "dark" }),
      "utf8",
    );

    await applyWritePlan(cwd, [
      {
        type: "json-merge",
        path: "opencode.json",
        merge: { $schema: "https://opencode.ai/config.json" },
        arrayUnion: { instructions: ["AGENTS.md"] },
        label: "opencode",
      },
    ]);

    const merged = JSON.parse(
      await readFile(path.join(cwd, "opencode.json"), "utf8"),
    );
    expect(merged.instructions).toEqual(["CONTRIBUTING.md", "AGENTS.md"]);
    expect(merged.theme).toBe("dark");
  });

  test("dry run reports changes without writing", async () => {
    const results = await applyWritePlan(
      cwd,
      [
        {
          type: "replace",
          path: "CLAUDE.md",
          content: "hello\n",
          label: "replace",
        },
      ],
      { dryRun: true },
    );

    expect(results[0]?.action).toBe("would-create");
    expect(await Bun.file(path.join(cwd, "CLAUDE.md")).exists()).toBe(false);
  });

  test("can include a static file diff in dry-run output", async () => {
    await writeFile(path.join(cwd, "AGENTS.md"), "old\n", "utf8");

    const results = await applyWritePlan(
      cwd,
      [
        {
          type: "replace",
          path: "AGENTS.md",
          content: "new\n",
          label: "replace",
        },
      ],
      { dryRun: true, showDiff: true },
    );

    expect(results[0]?.diff).toContain("--- AGENTS.md");
    expect(results[0]?.diff).toContain("- old");
    expect(results[0]?.diff).toContain("+ new");
    expect(await readFile(path.join(cwd, "AGENTS.md"), "utf8")).toBe("old\n");
  });

  test("backs up an existing static file before writing", async () => {
    await writeFile(path.join(cwd, "AGENTS.md"), "old\n", "utf8");

    const results = await applyWritePlan(
      cwd,
      [
        {
          type: "replace",
          path: "AGENTS.md",
          content: "new\n",
          label: "replace",
        },
      ],
      { backup: true },
    );

    const backupPath = results[0]?.backupPath;
    expect(backupPath).toStartWith(".poko/backups/");
    expect(await readFile(path.join(cwd, backupPath ?? ""), "utf8")).toBe(
      "old\n",
    );
    expect(await readFile(path.join(cwd, "AGENTS.md"), "utf8")).toBe("new\n");
  });
});
