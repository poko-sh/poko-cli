import { hasProjectContext, renderFullContext } from "../core/compiler.ts";
import { detectBySignals } from "../core/detect.ts";
import { hasMcpServers, renderVsCodeMcpJson } from "./common.ts";
import type { AgentAdapter, FileOperation } from "./types.ts";

export const copilotAdapter: AgentAdapter = {
  id: "copilot",
  displayName: "GitHub Copilot / VS Code",
  detect(root) {
    return detectBySignals(root, {
      id: "copilot",
      displayName: "GitHub Copilot / VS Code",
      binaries: [],
      projectPaths: [
        ".github/copilot-instructions.md",
        ".github/instructions",
        ".vscode/mcp.json",
      ],
    });
  },
  render(context, { config }) {
    const operations: FileOperation[] = [];

    if (hasProjectContext(context)) {
      operations.push({
        type: "managed-block",
        path: ".github/copilot-instructions.md",
        content: renderFullContext(context, "GitHub Copilot Project Context"),
        marker: "poko",
        commentStyle: "html",
        label: "GitHub Copilot custom instructions",
      });
    }

    if (config.adapters.copilot.mcp && hasMcpServers(context)) {
      operations.push({
        type: "json-merge",
        path: ".vscode/mcp.json",
        merge: renderVsCodeMcpJson(context),
        label: "VS Code MCP config",
      });
    }

    return operations;
  },
};
