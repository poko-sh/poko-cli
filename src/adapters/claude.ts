import {
  hasProjectContext,
  renderFullContext,
  renderSkillForClaude,
} from "../core/compiler.ts";
import { detectBySignals } from "../core/detect.ts";
import { hasMcpServers, renderMcpJson } from "./common.ts";
import type { AgentAdapter, FileOperation } from "./types.ts";

export const claudeAdapter: AgentAdapter = {
  id: "claude",
  displayName: "Claude Code",
  detect(root) {
    return detectBySignals(root, {
      id: "claude",
      displayName: "Claude Code",
      binaries: ["claude"],
      projectPaths: ["CLAUDE.md", ".claude", ".mcp.json"],
    });
  },
  render(context, { config }) {
    const operations: FileOperation[] = [];

    if (hasProjectContext(context)) {
      operations.push({
        type: "managed-block" as const,
        path: "CLAUDE.md",
        content: renderFullContext(context, "Claude Project Context"),
        marker: "poko",
        commentStyle: "html" as const,
        label: "Claude project memory",
      });
    }

    if (config.adapters.claude.mcp && hasMcpServers(context)) {
      operations.push({
        type: "json-merge" as const,
        path: ".mcp.json",
        merge: renderMcpJson(context),
        label: "Claude MCP config",
      });
    }

    if (config.adapters.claude.skills) {
      for (const skill of context.skills) {
        operations.push({
          type: "replace" as const,
          path: `.claude/skills/${skill.slug}/SKILL.md`,
          content: renderSkillForClaude(skill),
          label: `Claude skill ${skill.slug}`,
        });
      }
    }

    return operations;
  },
};
