import type { Database } from "bun:sqlite";
import type { CursorWorkspace } from "../cursor-storage.ts";
import type {
  CursorRenderedSession,
  CursorWriteStats,
} from "./cursor-types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPokoImportForProject = (
  value: Record<string, unknown>,
  projectRoot: string,
): boolean =>
  isRecord(value.pokoImport) &&
  value.pokoImport.originator === "poko" &&
  value.pokoImport.projectRoot === projectRoot;

const numberValue = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const writeCursorImports = (input: {
  globalDatabase: Database;
  workspaceDatabase: Database;
  workspace: CursorWorkspace;
  projectRoot: string;
  rendered: CursorRenderedSession[];
}): CursorWriteStats => {
  const desiredIds = new Set(
    input.rendered.map((session) => session.composerId),
  );
  const staleComposersRemoved = cleanupStalePokoCursorImports({
    database: input.globalDatabase,
    projectRoot: input.projectRoot,
    desiredIds,
  });

  for (const session of input.rendered) {
    input.globalDatabase
      .query("delete from cursorDiskKV where key like ?")
      .run(`bubbleId:${session.composerId}:%`);
  }

  mergeComposerHeads({
    database: input.workspaceDatabase,
    key: "composer.composerData",
    projectRoot: input.projectRoot,
    rendered: input.rendered,
    includeWorkspaceSelectionFields: true,
  });
  mergeComposerHeads({
    database: input.globalDatabase,
    key: "composer.composerHeaders",
    projectRoot: input.projectRoot,
    rendered: input.rendered,
    includeWorkspaceSelectionFields: false,
  });

  for (const session of input.rendered) {
    upsertKey(
      input.globalDatabase,
      "cursorDiskKV",
      `composerData:${session.composerId}`,
      JSON.stringify(session.composerData),
    );

    for (const bubble of session.bubbles) {
      upsertKey(
        input.globalDatabase,
        "cursorDiskKV",
        bubble.key,
        JSON.stringify(bubble.value),
      );
    }
  }

  mergeComposerPaneState(input.workspaceDatabase, input.rendered);

  return {
    composerRecordsWritten: input.rendered.length,
    bubblesWritten: input.rendered.reduce(
      (count, session) => count + session.bubbles.length,
      0,
    ),
    staleComposersRemoved,
  };
};

const mergeComposerHeads = (input: {
  database: Database;
  key: string;
  projectRoot: string;
  rendered: CursorRenderedSession[];
  includeWorkspaceSelectionFields: boolean;
}): void => {
  const desiredIds = new Set(
    input.rendered.map((session) => session.composerId),
  );
  const existing = parseJsonObject(
    queryKey(input.database, "ItemTable", input.key),
  );
  const existingHeads = Array.isArray(existing.allComposers)
    ? existing.allComposers.filter(isRecord)
    : [];
  const nextHeads = existingHeads.filter(
    (head) =>
      !isPokoImportForProject(head, input.projectRoot) ||
      (typeof head.composerId === "string" && desiredIds.has(head.composerId)),
  );

  for (const session of input.rendered) {
    const index = nextHeads.findIndex(
      (head) => head.composerId === session.composerId,
    );

    if (index >= 0) {
      nextHeads[index] = session.head;
    } else {
      nextHeads.push(session.head);
    }
  }

  nextHeads.sort(
    (left, right) =>
      numberValue(right.lastUpdatedAt) - numberValue(left.lastUpdatedAt),
  );

  const next: Record<string, unknown> = {
    ...existing,
    allComposers: nextHeads,
  };

  if (input.includeWorkspaceSelectionFields) {
    const firstDesired =
      input.rendered.find((session) => session.importKind === "continuation")
        ?.composerId ?? input.rendered[0]?.composerId;
    const existingSelected = Array.isArray(existing.selectedComposerIds)
      ? existing.selectedComposerIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];

    next.selectedComposerIds =
      existingSelected.length > 0
        ? existingSelected
        : firstDesired
          ? [firstDesired]
          : [];
    next.lastFocusedComposerIds =
      existingSelected.length > 0
        ? (existing.lastFocusedComposerIds ?? existingSelected)
        : firstDesired
          ? [firstDesired]
          : [];
    next.hasMigratedComposerData = true;
    next.hasMigratedMultipleComposers = true;
  }

  upsertKey(input.database, "ItemTable", input.key, JSON.stringify(next));
};

const mergeComposerPaneState = (
  database: Database,
  rendered: CursorRenderedSession[],
): void => {
  if (rendered.length === 0) {
    return;
  }

  const key = "workbench.panel.composerChatViewPane";
  const existing = parseJsonObject(queryKey(database, "ItemTable", key));

  for (const session of rendered) {
    existing[`workbench.panel.aichat.view.${session.composerId}`] = {
      collapsed: false,
      isHidden: false,
      size: 800,
    };
  }

  upsertKey(database, "ItemTable", key, JSON.stringify(existing));
  upsertKey(
    database,
    "ItemTable",
    "workbench.panel.aichat.numberOfVisibleViews",
    String(rendered.length),
  );
};

const cleanupStalePokoCursorImports = (input: {
  database: Database;
  projectRoot: string;
  desiredIds: Set<string>;
}): number => {
  const rows = input.database
    .query(
      "select key, value from cursorDiskKV where key like 'composerData:%' and value like '%\"pokoImport\"%'",
    )
    .all() as Array<{ key: string; value: string }>;
  let removed = 0;

  for (const row of rows) {
    const data = parseJsonObject(row.value);

    if (!isPokoImportForProject(data, input.projectRoot)) {
      continue;
    }

    const composerId = String(
      data.composerId ?? row.key.replace("composerData:", ""),
    );

    if (input.desiredIds.has(composerId)) {
      continue;
    }

    input.database
      .query("delete from cursorDiskKV where key = ?")
      .run(`composerData:${composerId}`);
    input.database
      .query("delete from cursorDiskKV where key like ?")
      .run(`bubbleId:${composerId}:%`);
    removed += 1;
  }

  return removed;
};

const queryKey = (
  database: Database,
  table: "ItemTable" | "cursorDiskKV",
  key: string,
): string | undefined => {
  const row = database
    .query(`select value from ${table} where key = ?`)
    .get(key) as { value?: string } | undefined;

  return typeof row?.value === "string" ? row.value : undefined;
};

const upsertKey = (
  database: Database,
  table: "ItemTable" | "cursorDiskKV",
  key: string,
  value: string,
): void => {
  database
    .query(`insert or replace into ${table} (key, value) values (?, ?)`)
    .run(key, value);
};

const parseJsonObject = (
  value: string | undefined,
): Record<string, unknown> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
