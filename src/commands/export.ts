import { getAdapter } from "../adapters/index.ts";
import {
  type AgentId,
  type FileOperation,
  type JsonObject,
  type JsonValue,
  resolveAgentId,
  supportedAgentList,
} from "../adapters/types.ts";
import { loadPokoContext } from "../core/config.ts";
import { stringifyJson } from "../core/json.ts";
import type { Logger } from "../core/logger.ts";
import { applyWritePlan, type WriteResult } from "../core/writer.ts";

export type ExportOptions = {
  cwd: string;
  agent?: string;
  stdout?: boolean;
  dryRun?: boolean;
  logger: Logger;
};

export const runExport = async (
  options: ExportOptions,
): Promise<WriteResult[] | string> => {
  if (!options.agent) {
    throw new Error("Missing agent. Usage: poko export <agent>");
  }

  const agent = parseAgentId(options.agent);
  const adapter = getAdapter(agent);

  if (!adapter) {
    throw new Error(`No adapter found for "${agent}".`);
  }

  const context = await loadPokoContext(options.cwd);
  const operations = adapter.render(context, { config: context.config });

  if (operations.length === 0) {
    options.logger.info(
      `nothing to export for ${agent}; add source context under .poko/ first.`,
    );
    return options.stdout ? "" : [];
  }

  if (options.stdout) {
    const rendered = renderOperationsForStdout(operations);
    options.logger.plain(rendered);
    return rendered;
  }

  const results = await applyWritePlan(context.root, operations, {
    dryRun: options.dryRun,
  });

  for (const result of results) {
    const prefix = result.action.replace("-", " ");
    options.logger.info(`${prefix}: ${result.path} (${result.label})`);
  }

  return results;
};

const renderOperationsForStdout = (operations: FileOperation[]): string => {
  return operations
    .map(
      (operation) =>
        `# ${operation.path}\n\n${renderOperationContent(operation).trimEnd()}`,
    )
    .join("\n\n---\n\n")
    .concat("\n");
};

const renderOperationContent = (operation: FileOperation): string => {
  switch (operation.type) {
    case "managed-block":
    case "replace":
      return operation.content;
    case "json-merge":
      return stringifyJson(
        applyArrayUnions(operation.merge, operation.arrayUnion),
      );
  }
};

const applyArrayUnions = (
  merge: JsonObject,
  arrayUnion?: Record<string, string[]>,
): JsonObject => {
  const output = JSON.parse(JSON.stringify(merge)) as JsonObject;

  for (const [keyPath, values] of Object.entries(arrayUnion ?? {})) {
    unionStringArrayAtPath(output, keyPath, values);
  }

  return output;
};

const unionStringArrayAtPath = (
  target: JsonObject,
  keyPath: string,
  values: string[],
): void => {
  const keys = keyPath.split(".");
  let current = target;

  for (const key of keys.slice(0, -1)) {
    const existing = current[key];

    if (!isJsonObject(existing)) {
      current[key] = {};
    }

    current = current[key] as JsonObject;
  }

  const finalKey = keys.at(-1);

  if (!finalKey) {
    return;
  }

  const existing = current[finalKey];
  const existingValues = Array.isArray(existing)
    ? existing.filter((entry): entry is string => typeof entry === "string")
    : [];

  current[finalKey] = [...new Set([...existingValues, ...values])];
};

const isJsonObject = (value: JsonValue | unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseAgentId = (value: string): AgentId => {
  const agent = resolveAgentId(value);

  if (agent) {
    return agent;
  }

  throw new Error(
    `Unknown agent "${value}". Supported agents: ${supportedAgentList()}.`,
  );
};
