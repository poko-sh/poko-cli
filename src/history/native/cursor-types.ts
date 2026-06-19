import type { CursorWorkspace } from "../cursor-storage.ts";
import type { RawHistorySession } from "../types.ts";

export const CURSOR_IMPORT_MODEL = "composer-2.5";
export const CURSOR_CONTINUATION_MESSAGE_LIMIT = 8;

export type CursorRenderedSession = {
  composerId: string;
  head: Record<string, unknown>;
  composerData: Record<string, unknown>;
  bubbles: Array<{ key: string; value: Record<string, unknown> }>;
  importKind?: "archive" | "continuation" | "native";
};

export type CursorSessionRenderInput = {
  session: RawHistorySession;
  workspace: CursorWorkspace;
  projectRoot: string;
  projectId: string;
  fallbackDate: Date;
  importKind?: "archive" | "continuation" | "native";
  composerIdSuffix?: string;
  titlePrefix?: string;
  messageLimit?: number;
  readOnly?: boolean;
  continuation?: boolean;
};

export type CursorRenderedBubble = {
  header: Record<string, unknown>;
  key: string;
  value: Record<string, unknown>;
};

export type CursorMessageAnnotations = {
  visibleText: string;
  thinkingText?: string;
  toolResult?: string;
  toolUses: CursorToolUse[];
  fileRefs: CursorFileRef[];
};

export type CursorToolUse = {
  name: string;
  input: Record<string, unknown>;
};

export type CursorFileRef = {
  relativePath: string;
  line?: number;
};

export type CursorWriteStats = {
  composerRecordsWritten: number;
  bubblesWritten: number;
  staleComposersRemoved: number;
};
