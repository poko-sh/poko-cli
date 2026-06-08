export const HISTORY_AGENTS = [
  "codex",
  "claude",
  "cursor",
  "pi",
  "hermes",
  "openclaw",
] as const;

export type HistoryAgent = (typeof HISTORY_AGENTS)[number];

export type HistoryStore = "local" | "repo" | "both";

export type HistoryRole = "user" | "assistant" | "system" | "tool" | "unknown";

export type RawHistoryMessage = {
  id?: string;
  role: HistoryRole;
  text: string;
  timestamp?: string;
  raw?: unknown;
};

export type RawHistorySession = {
  schemaVersion: 1;
  id: string;
  projectId?: string;
  sourceAgent: HistoryAgent;
  lineageId?: string;
  importedFromPoko?: boolean;
  originAgent?: string;
  originSessionId?: string;
  title: string;
  projectRoot: string;
  createdAt?: string;
  updatedAt?: string;
  sourcePath?: string;
  messages: RawHistoryMessage[];
  rawEvents?: unknown[];
};

export type HistoryIndexEntry = {
  id: string;
  projectId?: string;
  sourceAgent: HistoryAgent;
  title: string;
  projectRoot: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount: number;
  path: string;
};

export type HistoryIndex = {
  schemaVersion: 1;
  projectId?: string;
  projectRoot: string;
  updatedAt: string;
  sessions: HistoryIndexEntry[];
};

export type HistoryImporter = {
  id: HistoryAgent;
  displayName: string;
  capture(projectRoot: string): Promise<RawHistorySession[]>;
  captureAll?(): Promise<RawHistorySession[]>;
};

export const resolveHistoryAgent = (
  value: string,
): HistoryAgent | undefined => {
  const normalized = value.toLowerCase();

  if (HISTORY_AGENTS.includes(normalized as HistoryAgent)) {
    return normalized as HistoryAgent;
  }

  return undefined;
};

export const supportedHistoryAgents = (): string => HISTORY_AGENTS.join(", ");
