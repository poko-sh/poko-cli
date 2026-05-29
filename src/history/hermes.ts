import os from "node:os";
import path from "node:path";

export const resolveHermesHome = (): string =>
  process.env.HERMES_HOME ?? path.join(os.homedir(), ".hermes");

export const resolveHermesStateDbPath = (): string =>
  path.join(resolveHermesHome(), "state.db");
