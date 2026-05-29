import {
  hasProjectContext,
  renderFullContext,
  renderSkillForClaude,
} from "../core/compiler.ts";
import { detectBySignals } from "../core/detect.ts";
import type { AgentAdapter, FileOperation } from "./types.ts";

export const t3CodeAdapter: AgentAdapter = {
  id: "t3code",
  displayName: "T3 Code",
  detect(root) {
    return detectBySignals(root, {
      id: "t3code",
      displayName: "T3 Code",
      binaries: [],
      projectPaths: [".agents/skills", ".t3code"],
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
        label: "T3 Code agent context",
      });
    }

    if (config.adapters.t3code.skills) {
      for (const skill of context.skills) {
        operations.push({
          type: "replace",
          path: `.agents/skills/${skill.slug}/SKILL.md`,
          content: renderSkillForClaude(skill),
          label: `T3 Code skill ${skill.slug}`,
        });
      }
    }

    return operations;
  },
};
