import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../../core/config.ts";
import type { CursorWorkspace } from "../cursor-storage.ts";

export type CursorNativeBackup = {
  directory: string;
  files: string[];
};

const SQLITE_SIDECARS = ["", "-wal", "-shm"] as const;

const copySqliteBundle = async (
  sourcePath: string,
  destinationPath: string,
  files: string[],
): Promise<void> => {
  for (const suffix of SQLITE_SIDECARS) {
    const source = `${sourcePath}${suffix}`;
    if (!(await pathExists(source))) {
      continue;
    }

    const destination = `${destinationPath}${suffix}`;
    await copyFile(source, destination);
    files.push(destination);
  }
};

export const backupCursorNativeDatabases = async (input: {
  root: string;
  globalStateDbPath: string;
  workspace?: CursorWorkspace;
}): Promise<CursorNativeBackup> => {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const directory = path.join(
    input.root,
    ".poko",
    "backups",
    "cursor-native",
    timestamp,
  );
  const files: string[] = [];

  await mkdir(directory, { recursive: true });

  if (await pathExists(input.globalStateDbPath)) {
    await copySqliteBundle(
      input.globalStateDbPath,
      path.join(directory, "global-state.vscdb"),
      files,
    );
  }

  if (input.workspace && (await pathExists(input.workspace.databasePath))) {
    await copySqliteBundle(
      input.workspace.databasePath,
      path.join(directory, "workspace-state.vscdb"),
      files,
    );
  }

  return { directory, files };
};
