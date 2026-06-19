import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentDetection, AgentId } from "../adapters/types.ts";
import { pathExists } from "./config.ts";

export type InstallPath = {
  label: string;
  path: string;
};

type DetectSignals = {
  id: AgentId;
  displayName: string;
  binaries: string[];
  projectPaths: string[];
  installPaths?: InstallPath[];
};

export const detectBySignals = async (
  root: string,
  signals: DetectSignals,
): Promise<AgentDetection> => {
  const reasons: string[] = [];

  for (const binary of signals.binaries) {
    if (await findExecutable(binary)) {
      reasons.push(`found ${binary} on PATH`);
      break;
    }
  }

  for (const relativePath of signals.projectPaths) {
    if (await pathExists(path.join(root, relativePath))) {
      reasons.push(`found ${relativePath}`);
    }
  }

  for (const installPath of signals.installPaths ?? []) {
    if (await pathExists(installPath.path)) {
      reasons.push(`found ${installPath.label}`);
    }
  }

  return {
    id: signals.id,
    displayName: signals.displayName,
    detected: reasons.length > 0,
    reasons,
  };
};

const findExecutable = async (binary: string): Promise<boolean> => {
  const extensions =
    process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];

  for (const directory of executableSearchDirs()) {
    for (const extension of extensions) {
      try {
        await access(path.join(directory, `${binary}${extension}`));
        return true;
      } catch {
        // Try the next candidate.
      }
    }
  }

  return false;
};

const executableSearchDirs = (): string[] => {
  const seen = new Set<string>();
  const directories: string[] = [];

  const add = (directory: string | undefined): void => {
    if (!directory || seen.has(directory)) {
      return;
    }

    seen.add(directory);
    directories.push(directory);
  };

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    add(directory);
  }

  const home = os.homedir();
  add(path.join(home, ".local", "bin"));
  add(path.join(home, ".opencode", "bin"));
  add(path.join(home, ".bun", "bin"));
  add("/opt/homebrew/bin");
  add("/usr/local/bin");

  if (process.platform === "darwin") {
    add("/Applications/Cursor.app/Contents/Resources/app/bin");
    add("/Applications/Visual Studio Code.app/Contents/Resources/app/bin");
  }

  return directories;
};
