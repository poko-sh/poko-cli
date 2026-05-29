import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathExists } from "../../core/config.ts";
import type { HistoryRole, RawHistoryMessage } from "../types.ts";

export const homePath = (...parts: string[]): string =>
  path.join(os.homedir(), ...parts);

export const readJsonl = async (filePath: string): Promise<unknown[]> => {
  if (!(await pathExists(filePath))) {
    return [];
  }

  return (await readFile(filePath, "utf8"))
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
};

export const walkFiles = async (
  directory: string,
  predicate: (filePath: string) => boolean,
): Promise<string[]> => {
  if (!(await pathExists(directory))) {
    return [];
  }

  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(entryPath, predicate)));
      continue;
    }

    if (entry.isFile() && predicate(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
};

export const textFromContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (!isRecord(part)) {
        return "";
      }

      if (typeof part.text === "string") {
        return part.text;
      }

      if (typeof part.input_text === "string") {
        return part.input_text;
      }

      if (typeof part.output_text === "string") {
        return part.output_text;
      }

      if (typeof part.name === "string" && part.type === "tool_use") {
        return `[tool_use:${part.name}]`;
      }

      if (typeof part.name === "string" && part.type === "toolCall") {
        return `[tool_call:${part.name}]`;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n\n");
};

export const makeMessage = (
  role: HistoryRole,
  text: string,
  timestamp?: string,
  raw?: unknown,
  id?: string,
): RawHistoryMessage | undefined => {
  const clean = text.trim();

  if (!clean) {
    return undefined;
  }

  return { id, role, text: clean, timestamp, raw };
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const firstText = (messages: RawHistoryMessage[]): string | undefined =>
  messages
    .find((message) => message.role === "user")
    ?.text.split("\n")[0]
    ?.trim();

export const titleFrom = (
  fallback: string,
  messages: RawHistoryMessage[],
): string => truncate(firstText(messages) ?? fallback, 80);

export const truncate = (value: string, length: number): string =>
  value.length > length ? `${value.slice(0, length - 1)}...` : value;

export const dedupeMessages = (
  messages: RawHistoryMessage[],
): RawHistoryMessage[] => {
  const seen = new Set<string>();
  const unique: RawHistoryMessage[] = [];

  for (const message of messages) {
    const key = `${message.role}:${message.timestamp ?? ""}:${message.text}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(message);
  }

  return unique;
};
