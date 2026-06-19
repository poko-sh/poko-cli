import type { AgentId } from "../adapters/types.ts";
import type { Logger } from "../core/logger.ts";
import type { RawHistorySession } from "./types.ts";

export type SyncCapabilityLevel = "yes" | "partial" | "no";

export type SyncWarningContext = {
  targetAgents: AgentId[];
  sessions: RawHistorySession[];
};

export type SyncWarningRule = {
  when: (context: SyncWarningContext) => boolean;
  message: string;
};

export type AgentSyncWarningPolicy = {
  static?: string[];
  conditional?: SyncWarningRule[];
};

export type AgentSyncCapabilities = {
  id: AgentId;
  displayName: string;
  staticContext: SyncCapabilityLevel;
  historyImport: SyncCapabilityLevel;
  historyResume: SyncCapabilityLevel;
  requiresAppClose?: boolean;
  notes?: string;
  syncWarnings?: AgentSyncWarningPolicy;
};

export type HistoryCompatibilityReport = {
  summary: string;
  primaryRoutes: string[];
  agents: AgentSyncCapabilities[];
};

export const SYNC_CAPABILITY_SUMMARY =
  "Poko syncs project context everywhere it supports. Native chat resume works best between Codex and Claude Code. Cursor can import cross-agent history for reading, but imported threads cannot continue sending messages.";

const hasCrossAgentSessions = (context: SyncWarningContext): boolean =>
  context.sessions.some(
    (session) => !context.targetAgents.includes(session.sourceAgent),
  );

export const AGENT_SYNC_CAPABILITIES: AgentSyncCapabilities[] = [
  {
    id: "claude",
    displayName: "Claude Code",
    staticContext: "yes",
    historyImport: "yes",
    historyResume: "yes",
    notes: "Primary native chat target. JSONL session files.",
  },
  {
    id: "codex",
    displayName: "Codex",
    staticContext: "yes",
    historyImport: "yes",
    historyResume: "yes",
    notes: "Primary native chat source/target. Rollout JSONL sessions.",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    staticContext: "yes",
    historyImport: "partial",
    historyResume: "no",
    requiresAppClose: true,
    notes:
      "Cross-agent imports are read-only archives plus a separate Continue chat. Cursor requires a server session token to send messages in an existing thread.",
    syncWarnings: {
      conditional: [
        {
          when: hasCrossAgentSessions,
          message:
            "Cursor native chat sync imports cross-agent history for reading only. Imported threads cannot resume sending messages; use the generated Continue chat or poko handoff instead.",
        },
      ],
      static: [
        "Cursor Continue chats include at most 8 recent messages from the imported thread.",
        "Cursor native chat sync on macOS closes the app, backs up SQLite state, writes history, then reopens Cursor.",
      ],
    },
  },
  {
    id: "t3code",
    displayName: "T3 Code",
    staticContext: "yes",
    historyImport: "yes",
    historyResume: "yes",
    requiresAppClose: true,
    notes: "Native event-log writes on macOS require closing the app first.",
    syncWarnings: {
      static: [
        "T3 Code native chat sync on macOS closes the app before writing SQLite state.",
      ],
    },
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    staticContext: "yes",
    historyImport: "yes",
    historyResume: "partial",
    notes: "Uses opencode import; a running app may need refresh.",
  },
  {
    id: "pi",
    displayName: "Pi",
    staticContext: "yes",
    historyImport: "yes",
    historyResume: "yes",
    notes: "Project JSONL session files.",
  },
  {
    id: "hermes",
    displayName: "Hermes Agent",
    staticContext: "yes",
    historyImport: "yes",
    historyResume: "partial",
    notes: "SQLite session writes.",
  },
  {
    id: "openclaw",
    displayName: "OpenClaw",
    staticContext: "yes",
    historyImport: "yes",
    historyResume: "partial",
    notes: "Session JSONL writes.",
  },
];

export const PRIMARY_HISTORY_ROUTES = [
  "Codex ↔ Claude Code — full native chat import and resume",
  "Cursor — static context plus read-only cross-agent history; use Continue chat to start fresh",
  "poko handoff — portable markdown fallback when native resume is unavailable",
];

export const buildHistoryCompatibilityReport =
  (): HistoryCompatibilityReport => ({
    summary: SYNC_CAPABILITY_SUMMARY,
    primaryRoutes: PRIMARY_HISTORY_ROUTES,
    agents: AGENT_SYNC_CAPABILITIES,
  });

export const capabilityLabel = (level: SyncCapabilityLevel): string => {
  switch (level) {
    case "yes":
      return "Yes";
    case "partial":
      return "Partial";
    case "no":
      return "No";
  }
};

export const collectHistorySyncWarnings = (input: {
  targetAgents: AgentId[];
  sessions: RawHistorySession[];
}): string[] => {
  const warnings: string[] = [];
  const context: SyncWarningContext = input;

  for (const agentId of input.targetAgents) {
    const capabilities = getAgentSyncCapabilities(agentId);
    const policy = capabilities?.syncWarnings;

    if (!policy) {
      continue;
    }

    for (const rule of policy.conditional ?? []) {
      if (rule.when(context)) {
        warnings.push(rule.message);
      }
    }

    for (const message of policy.static ?? []) {
      warnings.push(message);
    }
  }

  return warnings;
};

export const reportHistoryCompatibility = (
  logger: Pick<Logger, "plain" | "warn">,
): void => {
  logger.plain("\nHistory Compatibility");
  logger.plain(`  ${SYNC_CAPABILITY_SUMMARY}`);
  logger.plain("  Primary routes:");
  for (const route of PRIMARY_HISTORY_ROUTES) {
    logger.plain(`    - ${route}`);
  }
  logger.plain(
    "  Run `poko doctor --json` and read historyCompatibility for the full table.",
  );
};

export const getAgentSyncCapabilities = (
  agentId: AgentId,
): AgentSyncCapabilities | undefined =>
  AGENT_SYNC_CAPABILITIES.find((agent) => agent.id === agentId);
