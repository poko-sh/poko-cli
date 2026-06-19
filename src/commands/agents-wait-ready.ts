import type { AgentId } from "../adapters/types.ts";
import { parseAgentIds } from "../core/agent-parse.ts";
import { probeAgents, waitForAgentsReady } from "../history/readiness.ts";

export type AgentsWaitReadyOptions = {
  cwd: string;
  agents?: string;
  timeoutMs?: number;
  wait?: boolean;
};

export type AgentsWaitReadyReport = {
  schemaVersion: 1;
  command: "agents wait-ready";
  generatedAt: string;
  root: string;
  timeoutMs: number;
  ready: boolean;
  agents: Array<{
    id: AgentId;
    ready: boolean;
    reason?: string;
  }>;
};

export const runAgentsWaitReady = async (
  options: AgentsWaitReadyOptions,
): Promise<AgentsWaitReadyReport> => {
  const agentIds = parseAgentIds(options.agents, { onUnknown: "skip" });
  const timeoutMs = options.timeoutMs ?? 30_000;
  const wait = options.wait ?? true;

  if (agentIds.length === 0) {
    return {
      schemaVersion: 1,
      command: "agents wait-ready",
      generatedAt: new Date().toISOString(),
      root: options.cwd,
      timeoutMs,
      ready: false,
      agents: [],
    };
  }

  const agents = wait
    ? await waitForAgentsReady({
        agents: agentIds,
        projectRoot: options.cwd,
        timeoutMs,
      })
    : await probeAgents(agentIds, options.cwd);

  return {
    schemaVersion: 1,
    command: "agents wait-ready",
    generatedAt: new Date().toISOString(),
    root: options.cwd,
    timeoutMs,
    ready: agents.every((agent) => agent.ready),
    agents,
  };
};

export const runAgentsWaitReadyReport = (
  options: AgentsWaitReadyOptions,
): Promise<AgentsWaitReadyReport> =>
  runAgentsWaitReady({ ...options, wait: true });

export const runAgentsWaitReadyProbe = (
  options: AgentsWaitReadyOptions,
): Promise<AgentsWaitReadyReport> =>
  runAgentsWaitReady({ ...options, wait: false });
