import {
  type AgentId,
  resolveAgentId,
  supportedAgentList,
} from "../adapters/types.ts";
import type { HistoryStore, RawHistorySession } from "../history/types.ts";
import type { PokoConfig } from "./config.ts";

export const parseAgentId = (value: string): AgentId => {
  const agent = resolveAgentId(value);

  if (agent) {
    return agent;
  }

  throw new Error(
    `Unknown agent "${value}". Supported agents: ${supportedAgentList()}.`,
  );
};

export const parseAgentIds = (
  value: string | undefined,
  options: { onUnknown: "throw" | "skip" } = { onUnknown: "throw" },
): AgentId[] => {
  if (!value) {
    return [];
  }

  const agents: AgentId[] = [];

  for (const part of value.split(",")) {
    const trimmed = part.trim();

    if (!trimmed) {
      continue;
    }

    const agent = resolveAgentId(trimmed);

    if (!agent) {
      if (options.onUnknown === "throw") {
        throw new Error(
          `Unknown agent "${trimmed}". Supported agents: ${supportedAgentList()}.`,
        );
      }

      continue;
    }

    if (!agents.includes(agent)) {
      agents.push(agent);
    }
  }

  return agents;
};

export const parseAgentList = (value: string): AgentId[] =>
  parseAgentIds(value, { onUnknown: "throw" });

export const parseStore = (value: string): HistoryStore => {
  if (value === "local" || value === "repo" || value === "both") {
    return value;
  }

  throw new Error('History store must be one of "local", "repo", or "both".');
};

export const filterProjectIncarnation = (
  sessions: RawHistorySession[],
  config: PokoConfig,
  options: { includePrevious?: boolean } = {},
): { sessions: RawHistorySession[]; skipped: RawHistorySession[] } => {
  if (
    options.includePrevious ||
    config.history.includePreviousProjectIncarnations
  ) {
    return { sessions, skipped: [] };
  }

  const projectCreatedAt = Date.parse(config.project.createdAt);

  if (!Number.isFinite(projectCreatedAt)) {
    return { sessions, skipped: [] };
  }

  const current: RawHistorySession[] = [];
  const skipped: RawHistorySession[] = [];

  for (const session of sessions) {
    const timestamp = Date.parse(session.updatedAt ?? session.createdAt ?? "");

    if (Number.isFinite(timestamp) && timestamp < projectCreatedAt) {
      skipped.push(session);
      continue;
    }

    current.push(session);
  }

  return { sessions: current, skipped };
};
