import { Database } from "bun:sqlite";
import os from "node:os";
import path from "node:path";
import type { AgentId } from "../adapters/types.ts";
import { pathExists } from "../core/config.ts";
import {
  findCursorWorkspaces,
  resolveCursorGlobalStateDbPath,
  resolveCursorWorkspaceStorageRoot,
} from "./cursor-storage.ts";

export type AgentReadiness = {
  id: AgentId;
  ready: boolean;
  reason?: string;
};

export const pollUntil = async (
  condition: () => Promise<boolean>,
  options: {
    timeoutMs: number;
    intervalMs?: number;
    wait?: (milliseconds: number) => Promise<void>;
  },
): Promise<boolean> => {
  const intervalMs = options.intervalMs ?? 500;
  const wait = options.wait ?? sleep;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= options.timeoutMs) {
    if (await condition()) {
      return true;
    }

    await wait(intervalMs);
  }

  return false;
};

export const probeAgentReadiness = async (
  agentId: AgentId,
  projectRoot: string,
): Promise<AgentReadiness> => {
  switch (agentId) {
    case "cursor":
      return probeCursorReadiness(projectRoot);
    case "t3code":
      return probeT3CodeReadiness();
    default:
      return { id: agentId, ready: true };
  }
};

export const waitForAgentsReady = async (options: {
  agents: AgentId[];
  projectRoot: string;
  timeoutMs: number;
  pollIntervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<AgentReadiness[]> => {
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const wait = options.wait ?? sleep;
  const deadline = Date.now() + options.timeoutMs;
  let latest = await probeAgents(options.agents, options.projectRoot);

  while (Date.now() < deadline) {
    if (latest.every((agent) => agent.ready)) {
      return latest;
    }

    await wait(pollIntervalMs);
    latest = await probeAgents(options.agents, options.projectRoot);
  }

  return latest;
};

export const probeAgents = async (
  agents: AgentId[],
  projectRoot: string,
): Promise<AgentReadiness[]> =>
  Promise.all(agents.map((agent) => probeAgentReadiness(agent, projectRoot)));

const probeCursorReadiness = async (
  projectRoot: string,
): Promise<AgentReadiness> => {
  const globalStateDbPath = resolveCursorGlobalStateDbPath();

  if (!(await pathExists(globalStateDbPath))) {
    return {
      id: "cursor",
      ready: false,
      reason: "Cursor global state database was not found.",
    };
  }

  if (!canOpenReadonlyDatabase(globalStateDbPath)) {
    return {
      id: "cursor",
      ready: false,
      reason: "Cursor global state database is locked or unavailable.",
    };
  }

  const workspaces = await findCursorWorkspaces(
    resolveCursorWorkspaceStorageRoot(),
    projectRoot,
  );

  for (const workspace of workspaces) {
    if (!(await pathExists(workspace.databasePath))) {
      continue;
    }

    if (!canOpenReadonlyDatabase(workspace.databasePath)) {
      return {
        id: "cursor",
        ready: false,
        reason: "Cursor workspace database is locked or unavailable.",
      };
    }
  }

  return { id: "cursor", ready: true };
};

const probeT3CodeReadiness = async (): Promise<AgentReadiness> => {
  const databasePath =
    process.env.POKO_T3CODE_DB_PATH ??
    path.join(os.homedir(), ".t3", "userdata", "state.sqlite");

  if (!(await pathExists(databasePath))) {
    return {
      id: "t3code",
      ready: false,
      reason: "T3 Code state database was not found.",
    };
  }

  if (!canOpenReadonlyDatabase(databasePath)) {
    return {
      id: "t3code",
      ready: false,
      reason: "T3 Code state database is locked or unavailable.",
    };
  }

  return { id: "t3code", ready: true };
};

const canOpenReadonlyDatabase = (databasePath: string): boolean => {
  try {
    const database = new Database(databasePath, { readonly: true });
    database.query("select 1").get();
    database.close();
    return true;
  } catch {
    return false;
  }
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
