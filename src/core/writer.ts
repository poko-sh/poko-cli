import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  FileOperation,
  JsonObject,
  JsonValue,
} from "../adapters/types.ts";
import { pathExists } from "./config.ts";
import { stringifyJson } from "./json.ts";

export type WriteAction =
  | "created"
  | "updated"
  | "unchanged"
  | "would-create"
  | "would-update"
  | "would-merge";

export type WriteResult = {
  path: string;
  label: string;
  action: WriteAction;
  backupPath?: string;
  diff?: string;
};

export type WriteOptions = {
  dryRun?: boolean;
  backup?: boolean;
  showDiff?: boolean;
};

export const applyWritePlan = async (
  root: string,
  operations: FileOperation[],
  options: WriteOptions = {},
): Promise<WriteResult[]> => {
  const results: WriteResult[] = [];

  for (const operation of operations) {
    results.push(await applyOperation(root, operation, options));
  }

  return results;
};

const applyOperation = async (
  root: string,
  operation: FileOperation,
  options: WriteOptions,
): Promise<WriteResult> => {
  const destination = path.join(root, operation.path);
  const existed = await pathExists(destination);
  const current = existed ? await readFile(destination, "utf8") : "";
  const next = await renderNextContent(current, operation);

  if (current === next) {
    return {
      path: operation.path,
      label: operation.label,
      action: "unchanged",
      diff: options.showDiff
        ? renderDiff(current, next, operation.path)
        : undefined,
    };
  }

  if (options.dryRun) {
    return {
      path: operation.path,
      label: operation.label,
      action: existed ? "would-update" : "would-create",
      diff: options.showDiff
        ? renderDiff(current, next, operation.path)
        : undefined,
    };
  }

  const backupPath =
    options.backup && existed
      ? await backupExisting(root, destination)
      : undefined;

  await writeAtomic(destination, next);
  return {
    path: operation.path,
    label: operation.label,
    action: existed ? "updated" : "created",
    backupPath,
  };
};

const renderNextContent = async (
  current: string,
  operation: FileOperation,
): Promise<string> => {
  switch (operation.type) {
    case "managed-block":
      return upsertManagedBlock(
        current,
        operation.content,
        operation.marker,
        operation.commentStyle,
      );
    case "replace":
      return ensureTrailingNewline(operation.content);
    case "json-merge":
      return renderMergedJson(current, operation.merge, operation.arrayUnion);
  }
};

const upsertManagedBlock = (
  current: string,
  content: string,
  marker: string,
  commentStyle: "html" | "hash",
): string => {
  const start =
    commentStyle === "html" ? `<!-- ${marker}:start -->` : `# ${marker}:start`;
  const end =
    commentStyle === "html" ? `<!-- ${marker}:end -->` : `# ${marker}:end`;
  const block = `${start}\n${content.trimEnd()}\n${end}\n`;

  if (!current.trim()) {
    return block;
  }

  const startIndex = current.indexOf(start);
  const endIndex = current.indexOf(end);

  if (startIndex >= 0 && endIndex >= 0 && endIndex > startIndex) {
    const before = current.slice(0, startIndex);
    const after = current.slice(endIndex + end.length).replace(/^\n+/, "");
    return ensureTrailingNewline(`${before}${block}${after}`);
  }

  return ensureTrailingNewline(`${current.trimEnd()}\n\n${block}`);
};

const renderMergedJson = (
  current: string,
  merge: JsonObject,
  arrayUnion?: Record<string, string[]>,
): string => {
  const existing = current.trim() ? parseJsonObject(current) : {};
  const merged = deepMerge(existing, merge);

  for (const [keyPath, values] of Object.entries(arrayUnion ?? {})) {
    unionStringArrayAtPath(merged, keyPath, values);
  }

  return stringifyJson(merged);
};

const parseJsonObject = (content: string): JsonObject => {
  const parsed = JSON.parse(content) as JsonValue;

  if (!isJsonObject(parsed)) {
    throw new Error("Expected JSON config to be an object.");
  }

  return parsed;
};

const deepMerge = (left: JsonObject, right: JsonObject): JsonObject => {
  const merged: JsonObject = { ...left };

  for (const [key, value] of Object.entries(right)) {
    const existing = merged[key];

    if (isJsonObject(existing) && isJsonObject(value)) {
      merged[key] = deepMerge(existing, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
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

const writeAtomic = async (
  destination: string,
  content: string,
): Promise<void> => {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`,
  );

  await writeFile(temporary, content, "utf8");
  await rename(temporary, destination);
};

const backupExisting = async (
  root: string,
  destination: string,
): Promise<string> => {
  const relative = path.relative(root, destination);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(root, ".poko", "backups", timestamp, relative);

  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(destination, backupPath);

  return path.relative(root, backupPath);
};

const ensureTrailingNewline = (content: string): string =>
  content.endsWith("\n") ? content : `${content}\n`;

const renderDiff = (
  current: string,
  next: string,
  filePath: string,
): string => {
  if (current === next) {
    return "";
  }

  const before = current.split("\n");
  const after = next.split("\n");
  const rows = [`--- ${filePath}`, `+++ ${filePath}`];
  const max = Math.max(before.length, after.length);

  for (let index = 0; index < max; index += 1) {
    const left = before[index];
    const right = after[index];

    if (left === right) {
      continue;
    }

    if (left !== undefined) {
      rows.push(`- ${left}`);
    }

    if (right !== undefined) {
      rows.push(`+ ${right}`);
    }
  }

  return rows.join("\n");
};
