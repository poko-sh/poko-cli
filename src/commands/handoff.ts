import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseStore } from "../core/agent-parse.ts";
import { loadPokoConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { renderHandoff } from "../history/render.ts";
import { loadHistorySessions } from "../history/storage.ts";
export type HandoffOptions = {
  cwd: string;
  agent?: string;
  store?: string;
  limit?: string;
  raw?: boolean;
  stdout?: boolean;
  logger: Logger;
};

export const runHandoff = async (options: HandoffOptions): Promise<string> => {
  const targetAgent = options.agent ?? "agent";
  const config = await loadPokoConfig(options.cwd);
  const store = parseStore(options.store ?? config.history.defaultStore);
  const limit = parseLimit(options.limit ?? "5");
  const sessions = await loadHistorySessions(
    options.cwd,
    store,
    limit,
    config.project.id,
  );

  if (sessions.length === 0) {
    throw new Error(
      "No captured history found. Run `poko capture --all` first.",
    );
  }

  const markdown = renderHandoff(targetAgent, sessions, Boolean(options.raw));

  if (options.stdout) {
    options.logger.plain(markdown);
    return markdown;
  }

  const handoffPath = path.join(
    options.cwd,
    ".poko",
    "handoffs",
    `${safeFilePart(targetAgent)}-latest.md`,
  );
  await mkdir(path.dirname(handoffPath), { recursive: true });
  await writeFile(handoffPath, markdown, "utf8");
  options.logger.success(`wrote ${path.relative(options.cwd, handoffPath)}.`);

  return markdown;
};

const parseLimit = (value: string): number => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("Handoff limit must be a positive integer.");
  }

  return parsed;
};

const safeFilePart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "agent";
