import { hasProjectContext, renderFullContext } from "../core/compiler.ts";
import { detectBySignals } from "../core/detect.ts";
import { hasMcpServers, renderMcpJson } from "./common.ts";
import type { AgentAdapter, FileOperation } from "./types.ts";

export const geminiAdapter: AgentAdapter = {
  id: "gemini",
  displayName: "Gemini CLI (legacy)",
  detect(root) {
    return detectBySignals(root, {
      id: "gemini",
      displayName: "Gemini CLI (legacy)",
      binaries: ["gemini"],
      projectPaths: ["GEMINI.md", ".gemini"],
    });
  },
  render(context, { config }) {
    const operations: FileOperation[] = [];

    if (hasProjectContext(context)) {
      operations.push({
        type: "managed-block",
        path: "GEMINI.md",
        content: renderFullContext(context, "Google Agent Project Context"),
        marker: "poko",
        commentStyle: "html",
        label: "Gemini legacy context",
      });
    }

    if (config.adapters.gemini.mcp && hasMcpServers(context)) {
      operations.push({
        type: "json-merge",
        path: ".gemini/settings.json",
        merge: renderMcpJson(context),
        label: "Gemini MCP settings",
      });
    }

    return operations;
  },
};
