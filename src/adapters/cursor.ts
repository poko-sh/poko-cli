import { hasProjectContext, renderFullContext } from "../core/compiler.ts";
import { detectBySignals } from "../core/detect.ts";
import { hasMcpServers, renderMcpJson } from "./common.ts";
import type { AgentAdapter, FileOperation } from "./types.ts";

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  displayName: "Cursor",
  detect(root) {
    return detectBySignals(root, {
      id: "cursor",
      displayName: "Cursor",
      binaries: ["cursor"],
      projectPaths: [".cursor", ".cursorrules"],
    });
  },
  render(context, { config }) {
    const operations: FileOperation[] = [];

    if (!hasProjectContext(context)) {
      if (config.adapters.cursor.mcp && hasMcpServers(context)) {
        operations.push({
          type: "json-merge",
          path: ".cursor/mcp.json",
          merge: renderMcpJson(context),
          label: "Cursor MCP config",
        });
      }

      return operations;
    }

    const content = `---
description: Poko project context. Use when working in this repository.
globs:
alwaysApply: true
---

${renderFullContext(context, "Cursor Project Context")}`;

    operations.push({
      type: "replace",
      path: ".cursor/rules/poko.mdc",
      content,
      label: "Cursor project rule",
    });

    if (config.adapters.cursor.legacyCursorrules) {
      operations.push({
        type: "managed-block",
        path: ".cursorrules",
        content: renderFullContext(context, "Cursor Legacy Context"),
        marker: "poko",
        commentStyle: "hash",
        label: "Cursor legacy rules",
      });
    }

    if (config.adapters.cursor.mcp && hasMcpServers(context)) {
      operations.push({
        type: "json-merge",
        path: ".cursor/mcp.json",
        merge: renderMcpJson(context),
        label: "Cursor MCP config",
      });
    }

    return operations;
  },
};
