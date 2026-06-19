import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { backupCursorNativeDatabases } from "../../src/history/native/cursor-backup.ts";

const tempRoot = path.join(import.meta.dir, ".tmp-cursor-backup");

beforeEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("backs up global and workspace Cursor databases", async () => {
  const globalStateDbPath = path.join(tempRoot, "global-state.vscdb");
  const workspaceDbPath = path.join(tempRoot, "workspace-state.vscdb");
  await writeFile(globalStateDbPath, "global");
  await writeFile(workspaceDbPath, "workspace");

  const backup = await backupCursorNativeDatabases({
    root: tempRoot,
    globalStateDbPath,
    workspace: {
      id: "workspace-id",
      directory: path.join(tempRoot, "workspace"),
      workspacePath: path.join(tempRoot, "workspace", "workspace.json"),
      databasePath: workspaceDbPath,
      folderUri: `file://${tempRoot}`,
    },
  });

  expect(backup.files).toHaveLength(2);
  expect(backup.directory).toStartWith(
    path.join(tempRoot, ".poko/backups/cursor-native"),
  );
});

test("backs up SQLite WAL and SHM sidecars when present", async () => {
  const globalStateDbPath = path.join(tempRoot, "global-state.vscdb");
  await writeFile(globalStateDbPath, "global");
  await writeFile(`${globalStateDbPath}-wal`, "wal");
  await writeFile(`${globalStateDbPath}-shm`, "shm");

  const backup = await backupCursorNativeDatabases({
    root: tempRoot,
    globalStateDbPath,
  });

  expect(backup.files).toHaveLength(3);
  expect(
    backup.files.some((file) => file.endsWith("global-state.vscdb-wal")),
  ).toBe(true);
  expect(
    backup.files.some((file) => file.endsWith("global-state.vscdb-shm")),
  ).toBe(true);
});
