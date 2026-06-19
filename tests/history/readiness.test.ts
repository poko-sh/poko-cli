import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCursorStateDatabase } from "../../src/history/cursor-storage.ts";
import { probeAgentReadiness } from "../../src/history/readiness.ts";
import { makeTempDir, removeTempDir } from "../helpers.ts";

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempDir();
});

afterEach(async () => {
  delete process.env.POKO_CURSOR_GLOBAL_STATE_DB;
  delete process.env.POKO_T3CODE_DB_PATH;
  await removeTempDir(cwd);
});

describe("agent readiness", () => {
  test("reports cursor ready when its databases can be opened read-only", async () => {
    const globalDb = path.join(cwd, "global-state.vscdb");
    const storageRoot = path.join(cwd, "workspaceStorage");
    const workspaceId = "abc123";
    const workspaceDb = path.join(storageRoot, workspaceId, "state.vscdb");

    process.env.POKO_CURSOR_GLOBAL_STATE_DB = globalDb;
    process.env.POKO_CURSOR_STORAGE_ROOT = storageRoot;

    await mkdir(path.join(storageRoot, workspaceId), { recursive: true });
    ensureCursorStateDatabase(globalDb, ["ItemTable", "cursorDiskKV"]);
    ensureCursorStateDatabase(workspaceDb, ["ItemTable"]);
    await writeFile(
      path.join(storageRoot, workspaceId, "workspace.json"),
      JSON.stringify({ folder: `file://${cwd}` }),
      "utf8",
    );

    const readiness = await probeAgentReadiness("cursor", cwd);

    expect(readiness.ready).toBe(true);
  });

  test("reports cursor unavailable when the global database is missing", async () => {
    process.env.POKO_CURSOR_GLOBAL_STATE_DB = path.join(
      cwd,
      "missing-global.vscdb",
    );

    const readiness = await probeAgentReadiness("cursor", cwd);

    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toContain("not found");
  });
});
