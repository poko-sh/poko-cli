import { describe, expect, test } from "bun:test";
import { collapseEquivalentSessions } from "../../src/history/lineage.ts";
import type { RawHistorySession } from "../../src/history/types.ts";

describe("history lineage", () => {
  test("keeps the original source for exact imported copies", () => {
    const original = makeSession({
      id: "codex-source",
      sourceAgent: "codex",
    });
    const importedCopy = makeSession({
      id: "cursor-copy",
      sourceAgent: "cursor",
      importedFromPoko: true,
      originAgent: "codex",
      originSessionId: "codex-source",
      lineageId: "codex:codex-source",
    });

    expect(collapseEquivalentSessions([importedCopy, original])).toEqual([
      original,
    ]);
  });

  test("keeps a continued imported copy as the current source", () => {
    const original = makeSession({
      id: "codex-source",
      sourceAgent: "codex",
    });
    const continued = makeSession({
      id: "cursor-copy",
      sourceAgent: "cursor",
      importedFromPoko: true,
      originAgent: "codex",
      originSessionId: "codex-source",
      lineageId: "codex:codex-source",
      messages: [
        message("user", "please fix this"),
        message("assistant", "fixed"),
        message("user", "continue in cursor"),
      ],
    });

    expect(collapseEquivalentSessions([original, continued])).toEqual([
      continued,
    ]);
  });
});

const makeSession = (
  options: Partial<RawHistorySession> & {
    id: string;
    sourceAgent: RawHistorySession["sourceAgent"];
  },
): RawHistorySession => ({
  schemaVersion: 1,
  title: "Shared conversation",
  projectRoot: "/tmp/poko-project",
  createdAt: "2026-05-29T00:00:00.000Z",
  updatedAt: "2026-05-29T00:00:02.000Z",
  messages: [message("user", "please fix this"), message("assistant", "fixed")],
  ...options,
});

const message = (
  role: "user" | "assistant",
  text: string,
): RawHistorySession["messages"][number] => ({
  role,
  text,
});
