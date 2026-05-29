import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { INIT_TEMPLATES } from "../templates/init.ts";

export type InitOptions = {
  cwd: string;
  force?: boolean;
  yes?: boolean;
  logger: Logger;
};

export type InitResult = {
  path: string;
  action: "created" | "skipped" | "overwritten";
};

export const runInit = async (options: InitOptions): Promise<InitResult[]> => {
  const results: InitResult[] = [];

  for (const template of INIT_TEMPLATES) {
    const destination = path.join(options.cwd, template.path);
    const exists = await pathExists(destination);

    if (exists && !options.force) {
      results.push({ path: template.path, action: "skipped" });
      continue;
    }

    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(
      destination,
      renderTemplate(template.path, template.content),
      "utf8",
    );
    results.push({
      path: template.path,
      action: exists ? "overwritten" : "created",
    });
  }

  reportInitResults(results, options.logger);
  return results;
};

const renderTemplate = (templatePath: string, content: string): string => {
  if (templatePath !== ".poko/poko.json") {
    return content;
  }

  const config = JSON.parse(content) as {
    project?: { id?: string; createdAt?: string };
  };
  config.project = {
    ...config.project,
    id: config.project?.id || randomUUID(),
    createdAt: config.project?.createdAt || new Date().toISOString(),
  };

  return `${JSON.stringify(config, null, 2)}\n`;
};

const reportInitResults = (results: InitResult[], logger: Logger): void => {
  const created = results.filter(
    (result) => result.action === "created",
  ).length;
  const overwritten = results.filter(
    (result) => result.action === "overwritten",
  ).length;
  const skipped = results.filter(
    (result) => result.action === "skipped",
  ).length;

  if (created > 0 || overwritten > 0) {
    logger.success(`initialized .poko/ with ${created + overwritten} file(s).`);
  }

  if (skipped > 0) {
    logger.info(`left ${skipped} existing file(s) untouched.`);
  }

  logger.info(
    "next: add .poko/rules.md, .poko/mcp.json, or other context only when you have something to sync.",
  );
};
