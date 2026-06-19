import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fileExists, pathExists } from "../core/config.ts";

export type CursorWorkspace = {
  id: string;
  directory: string;
  workspacePath: string;
  databasePath: string;
  folderUri: string;
};

export const resolveCursorWorkspaceStorageRoot = (): string =>
  process.env.POKO_CURSOR_STORAGE_ROOT ??
  path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Cursor",
    "User",
    "workspaceStorage",
  );

export const resolveCursorGlobalStateDbPath = (): string =>
  process.env.POKO_CURSOR_GLOBAL_STATE_DB ??
  path.join(
    process.env.POKO_CURSOR_GLOBAL_STORAGE_ROOT ??
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
      ),
    "state.vscdb",
  );

export const findCursorWorkspaces = async (
  storageRoot: string,
  projectRoot: string,
): Promise<CursorWorkspace[]> => {
  const canonicalProjectRoot = await canonicalPath(projectRoot);
  const workspaces = await listCursorWorkspaces(storageRoot);
  const matched: CursorWorkspace[] = [];

  for (const workspace of workspaces) {
    const normalized = normalizeCursorWorkspacePath(workspace.folderUri);

    if (
      normalized &&
      (await canonicalPath(normalized)) === canonicalProjectRoot
    ) {
      matched.push(workspace);
    }
  }

  return matched;
};

export const listCursorWorkspaces = async (
  storageRoot: string,
): Promise<CursorWorkspace[]> => {
  if (!(await pathExists(storageRoot))) {
    return [];
  }

  const entries = await readdir(storageRoot, { withFileTypes: true });
  const workspaces: CursorWorkspace[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = path.join(storageRoot, entry.name);
    const workspacePath = path.join(directory, "workspace.json");
    const databasePath = path.join(directory, "state.vscdb");

    if (
      !(await fileExists(workspacePath)) ||
      !(await fileExists(databasePath))
    ) {
      continue;
    }

    const raw = JSON.parse(await readFile(workspacePath, "utf8")) as {
      folder?: string;
      workspace?: string;
    };
    const folder = normalizeCursorWorkspacePath(raw.folder ?? raw.workspace);

    if (folder) {
      workspaces.push({
        id: entry.name,
        directory,
        workspacePath,
        databasePath,
        folderUri: raw.folder ?? raw.workspace ?? pathToFileURL(folder).href,
      });
    }
  }

  return workspaces;
};

export const ensureCursorWorkspace = async (
  storageRoot: string,
  projectRoot: string,
): Promise<CursorWorkspace> => {
  const existing = await findCursorWorkspaces(storageRoot, projectRoot);

  if (existing[0]) {
    return existing[0];
  }

  const id = createCursorWorkspaceId(projectRoot);
  const directory = path.join(storageRoot, id);
  const workspacePath = path.join(directory, "workspace.json");
  const databasePath = path.join(directory, "state.vscdb");
  const folderUri = pathToFileURL(projectRoot).href;

  await mkdir(directory, { recursive: true });
  await writeFile(workspacePath, JSON.stringify({ folder: folderUri }), "utf8");
  ensureCursorStateDatabase(databasePath, ["ItemTable"]);

  return {
    id,
    directory,
    workspacePath,
    databasePath,
    folderUri,
  };
};

export const ensureCursorStateDatabase = (
  databasePath: string,
  tables: Array<"ItemTable" | "cursorDiskKV">,
): void => {
  const database = new Database(databasePath);

  try {
    database.run("pragma busy_timeout = 5000");

    for (const table of tables) {
      database.run(
        `create table if not exists ${table} (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)`,
      );
    }
  } finally {
    database.close();
  }
};

export const normalizeCursorWorkspacePath = (
  value: string | undefined,
): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (value.startsWith("file:")) {
    return fileURLToPath(value);
  }

  if (value.includes("://")) {
    return undefined;
  }

  return value;
};

export const cursorFileUri = (projectRoot: string): string =>
  pathToFileURL(projectRoot).href;

export const cursorWorkspaceIdentifier = (
  workspace: Pick<CursorWorkspace, "id" | "folderUri">,
  projectRoot: string,
): Record<string, unknown> => ({
  id: workspace.id,
  uri: {
    $mid: 1,
    fsPath: projectRoot,
    external: workspace.folderUri,
    path: projectRoot,
    scheme: "file",
  },
});

const createCursorWorkspaceId = (projectRoot: string): string =>
  createHash("sha256")
    .update(`poko:cursor:workspace:${projectRoot}`)
    .digest("hex")
    .slice(0, 32);

const canonicalPath = async (value: string): Promise<string> => {
  try {
    return (await realpath(value)).normalize("NFC");
  } catch {
    return path.resolve(value).normalize("NFC");
  }
};
