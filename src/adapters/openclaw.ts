import os from "node:os";
import path from "node:path";
import {
  hasProjectContext,
  renderFullContext,
  renderSkillForClaude,
} from "../core/compiler.ts";
import { detectBySignals } from "../core/detect.ts";
import type { AgentAdapter, FileOperation } from "./types.ts";

export const openClawAdapter: AgentAdapter = {
  id: "openclaw",
  displayName: "OpenClaw",
  detect(root) {
    const home = os.homedir();

    return detectBySignals(root, {
      id: "openclaw",
      displayName: "OpenClaw",
      binaries: ["openclaw", "claw"],
      projectPaths: [
        "AGENTS.md",
        "SOUL.md",
        "TOOLS.md",
        ".agents/skills",
        ".openclaw",
      ],
      installPaths: [
        {
          label: "OpenClaw home",
          path: path.join(home, ".openclaw"),
        },
        {
          label: "OpenClaw config",
          path: path.join(home, ".config", "openclaw"),
        },
      ],
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
        label: "OpenClaw project context",
      });
    }

    if (config.adapters.openclaw.skills) {
      for (const skill of context.skills) {
        operations.push({
          type: "replace",
          path: `.agents/skills/${skill.slug}/SKILL.md`,
          content: renderSkillForClaude(skill),
          label: `OpenClaw skill ${skill.slug}`,
        });
      }
    }

    return operations;
  },
};
