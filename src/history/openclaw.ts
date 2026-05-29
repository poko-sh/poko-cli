import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_AGENT_ID = "main";

export const resolveOpenClawStateDir = (): string =>
  process.env.OPENCLAW_STATE_DIR
    ? resolveUserPath(process.env.OPENCLAW_STATE_DIR)
    : resolveDefaultOpenClawStateDir();

export const resolveOpenClawAgentSessionsDir = (
  agentId = DEFAULT_AGENT_ID,
): string =>
  path.join(resolveOpenClawStateDir(), "agents", agentId, "sessions");

export const resolveOpenClawSessionStorePath = (
  agentId = DEFAULT_AGENT_ID,
): string =>
  path.join(resolveOpenClawAgentSessionsDir(agentId), "sessions.json");

const resolveDefaultOpenClawStateDir = (): string => {
  const home = resolveOpenClawHome();
  const stateDir = path.join(home, ".openclaw");
  const legacyStateDir = path.join(home, ".clawdbot");

  if (!existsSync(stateDir) && existsSync(legacyStateDir)) {
    return legacyStateDir;
  }

  return stateDir;
};

const resolveOpenClawHome = (): string =>
  process.env.OPENCLAW_HOME
    ? resolveUserPath(process.env.OPENCLAW_HOME)
    : os.homedir();

const resolveUserPath = (value: string): string => {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return path.resolve(value);
};
