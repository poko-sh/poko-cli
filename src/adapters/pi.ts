import {
  hasProjectContext,
  renderFullContext,
  renderSkillForClaude,
} from "../core/compiler.ts";
import { detectBySignals } from "../core/detect.ts";
import type { AgentAdapter, FileOperation } from "./types.ts";

export const piAdapter: AgentAdapter = {
  id: "pi",
  displayName: "Pi",
  detect(root) {
    return detectBySignals(root, {
      id: "pi",
      displayName: "Pi",
      binaries: ["pi"],
      projectPaths: ["AGENTS.md", "CLAUDE.md", ".pi", ".agents/skills"],
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
        label: "Pi project context",
      });
    }

    if (config.adapters.pi.skills) {
      for (const skill of context.skills) {
        operations.push({
          type: "replace",
          path: `.pi/skills/${skill.slug}/SKILL.md`,
          content: renderSkillForClaude(skill),
          label: `Pi skill ${skill.slug}`,
        });
      }
    }

    return operations;
  },
};
