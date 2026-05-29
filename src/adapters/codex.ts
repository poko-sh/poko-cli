import { hasProjectContext, renderFullContext } from "../core/compiler.ts";
import { detectBySignals } from "../core/detect.ts";
import { hasMcpServers, renderCodexMcpToml } from "./common.ts";
import type { AgentAdapter, FileOperation } from "./types.ts";

export const codexAdapter: AgentAdapter = {
  id: "codex",
  displayName: "Codex / AGENTS.md",
  detect(root) {
    return detectBySignals(root, {
      id: "codex",
      displayName: "Codex / AGENTS.md",
      binaries: ["codex"],
      projectPaths: ["AGENTS.md", ".codex"],
    });
  },
  render(context, { config }) {
    const operations: FileOperation[] = [];

    if (hasProjectContext(context)) {
      operations.push({
        type: "managed-block",
        path: "AGENTS.md",
        content: renderFullContext(context, "Agent Project Context"),
        marker: "poko",
        commentStyle: "html",
        label: "AGENTS.md context",
      });
    }

    if (config.adapters.codex.mcp && hasMcpServers(context)) {
      operations.push({
        type: "managed-block",
        path: ".codex/config.toml",
        content: renderCodexMcpToml(context),
        marker: "poko",
        commentStyle: "hash",
        label: "Codex project MCP config",
      });
    }

    return operations;
  },
};
