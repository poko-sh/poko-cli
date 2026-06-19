import { describe, expect, test } from "bun:test";
import {
  AGENT_SYNC_CAPABILITIES,
  collectHistorySyncWarnings,
  getAgentSyncCapabilities,
} from "../../src/history/sync-capabilities.ts";

describe("history sync capabilities", () => {
  test("marks Cursor cross-agent history as read-only", () => {
    const cursor = getAgentSyncCapabilities("cursor");

    expect(cursor?.historyImport).toBe("partial");
    expect(cursor?.historyResume).toBe("no");
  });

  test("marks Codex and Claude as full resume targets", () => {
    expect(getAgentSyncCapabilities("codex")?.historyResume).toBe("yes");
    expect(getAgentSyncCapabilities("claude")?.historyResume).toBe("yes");
  });

  test("cursor warnings derive from capability policy", () => {
    const cursor = getAgentSyncCapabilities("cursor");

    expect(cursor?.syncWarnings?.static?.length).toBeGreaterThan(0);
    expect(cursor?.syncWarnings?.conditional?.length).toBeGreaterThan(0);
  });

  test("warns when syncing cross-agent history into Cursor", () => {
    const warnings = collectHistorySyncWarnings({
      targetAgents: ["cursor"],
      sessions: [
        {
          schemaVersion: 1,
          id: "codex-1",
          sourceAgent: "codex",
          title: "Example",
          projectRoot: "/tmp/project",
          messages: [],
        },
      ],
    });

    expect(warnings.some((warning) => warning.includes("reading only"))).toBe(
      true,
    );
  });

  test("documents every supported adapter", () => {
    expect(AGENT_SYNC_CAPABILITIES.map((agent) => agent.id)).toEqual([
      "claude",
      "codex",
      "cursor",
      "t3code",
      "opencode",
      "pi",
      "hermes",
      "openclaw",
    ]);
  });
});
