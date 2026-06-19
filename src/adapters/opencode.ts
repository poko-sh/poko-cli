import os from "node:os";
import path from "node:path";
import { hasProjectContext, renderFullContext } from "../core/compiler.ts";
import { detectBySignals } from "../core/detect.ts";
import { hasMcpServers, renderOpenCodeConfigJson } from "./common.ts";
import type { AgentAdapter, FileOperation } from "./types.ts";

export const openCodeAdapter: AgentAdapter = {
  id: "opencode",
  displayName: "OpenCode",
  detect(root) {
    const home = os.homedir();

    return detectBySignals(root, {
      id: "opencode",
      displayName: "OpenCode",
      binaries: ["opencode"],
      projectPaths: ["opencode.json", "opencode.jsonc", ".opencode"],
      installPaths: [
        {
          label: "OpenCode CLI",
          path: path.join(home, ".opencode", "bin", "opencode"),
        },
        {
          label: "OpenCode data",
          path: path.join(home, ".local", "share", "opencode"),
        },
        {
          label: "OpenCode config",
          path: path.join(home, ".config", "opencode", "opencode.json"),
        },
      ],
    });
  },
  render(context, { config }) {
    const operations: FileOperation[] = [];
    const hasContext = hasProjectContext(context);
    const shouldWriteConfig =
      hasContext || (config.adapters.opencode.mcp && hasMcpServers(context));

    if (hasContext) {
      operations.push({
        type: "managed-block",
        path: "AGENTS.md",
        content: renderFullContext(context, "Agent Project Context"),
        marker: "poko",
        commentStyle: "html",
        label: "OpenCode project rules",
      });
    }

    if (shouldWriteConfig) {
      operations.push({
        type: "json-merge",
        path: "opencode.json",
        merge: config.adapters.opencode.mcp
          ? renderOpenCodeConfigJson(context)
          : { $schema: "https://opencode.ai/config.json" },
        ...(hasContext ? { arrayUnion: { instructions: ["AGENTS.md"] } } : {}),
        label: "OpenCode project config",
      });
    }

    return operations;
  },
};
