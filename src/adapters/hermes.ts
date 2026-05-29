import {
  hasProjectContext,
  renderFullContext,
  renderSkillForClaude,
} from "../core/compiler.ts";
import { detectBySignals } from "../core/detect.ts";
import type { AgentAdapter, FileOperation } from "./types.ts";

export const hermesAdapter: AgentAdapter = {
  id: "hermes",
  displayName: "Hermes Agent",
  detect(root) {
    return detectBySignals(root, {
      id: "hermes",
      displayName: "Hermes Agent",
      binaries: ["hermes"],
      projectPaths: ["AGENTS.md", ".hermes.md", ".agents/skills", ".hermes"],
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
        label: "Hermes project context",
      });
    }

    if (config.adapters.hermes.skills) {
      for (const skill of context.skills) {
        operations.push({
          type: "replace",
          path: `.agents/skills/${skill.slug}/SKILL.md`,
          content: renderSkillForClaude(skill),
          label: `Hermes portable skill ${skill.slug}`,
        });
      }
    }

    return operations;
  },
};
