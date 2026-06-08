import { createHash } from "node:crypto";
import path from "node:path";
import type { RawHistoryMessage, RawHistorySession } from "./types.ts";

export const collapseEquivalentSessions = (
  sessions: RawHistorySession[],
): RawHistorySession[] =>
  collapseByKey(
    collapseByKey(sessions, lineageKey),
    transcriptFingerprintKey,
  ).sort(compareSessions);

export const sourceLineageId = (session: RawHistorySession): string =>
  session.lineageId ?? `${session.sourceAgent}:${session.id}`;

export const importedLineageId = (input: {
  sourceAgent?: string;
  sourceSessionId?: string;
}): string | undefined =>
  input.sourceAgent && input.sourceSessionId
    ? `${input.sourceAgent}:${input.sourceSessionId}`
    : undefined;

const collapseByKey = (
  sessions: RawHistorySession[],
  keyForSession: (session: RawHistorySession) => string | undefined,
): RawHistorySession[] => {
  const grouped = new Map<string, RawHistorySession>();
  const ungrouped: RawHistorySession[] = [];

  for (const session of sessions) {
    const key = keyForSession(session);

    if (!key) {
      ungrouped.push(session);
      continue;
    }

    const current = grouped.get(key);
    grouped.set(key, current ? preferredSession(current, session) : session);
  }

  return [...grouped.values(), ...ungrouped];
};

const lineageKey = (session: RawHistorySession): string =>
  [
    "lineage",
    normalizeProjectRoot(session.projectRoot),
    sourceLineageId(session),
  ].join(":");

const transcriptFingerprintKey = (
  session: RawHistorySession,
): string | undefined => {
  const messages = conversationMessages(session);
  const totalTextLength = messages.reduce(
    (total, message) => total + normalizeText(message.text).length,
    0,
  );

  if (messages.length < 2 && totalTextLength < 200) {
    return undefined;
  }

  const payload = messages
    .map((message) => `${message.role}:${normalizeText(message.text)}`)
    .join("\n");
  const fingerprint = createHash("sha256")
    .update(payload)
    .digest("hex")
    .slice(0, 24);

  return [
    "transcript",
    normalizeProjectRoot(session.projectRoot),
    fingerprint,
  ].join(":");
};

const preferredSession = (
  left: RawHistorySession,
  right: RawHistorySession,
): RawHistorySession => {
  const leftMessages = conversationMessages(left).length;
  const rightMessages = conversationMessages(right).length;

  if (leftMessages !== rightMessages) {
    return leftMessages > rightMessages ? left : right;
  }

  if (Boolean(left.importedFromPoko) !== Boolean(right.importedFromPoko)) {
    return left.importedFromPoko ? right : left;
  }

  const leftTimestamp = left.updatedAt ?? left.createdAt ?? "";
  const rightTimestamp = right.updatedAt ?? right.createdAt ?? "";

  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp > rightTimestamp ? left : right;
  }

  return `${left.sourceAgent}:${left.id}` <= `${right.sourceAgent}:${right.id}`
    ? left
    : right;
};

const conversationMessages = (
  session: RawHistorySession,
): RawHistoryMessage[] =>
  session.messages.filter(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      message.text.trim().length > 0,
  );

const normalizeProjectRoot = (projectRoot: string): string =>
  path.resolve(projectRoot).normalize("NFC");

const normalizeText = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const compareSessions = (
  left: RawHistorySession,
  right: RawHistorySession,
): number =>
  (right.updatedAt ?? right.createdAt ?? "").localeCompare(
    left.updatedAt ?? left.createdAt ?? "",
  );
