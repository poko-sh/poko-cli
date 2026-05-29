import { hasProjectContext, renderFullContext } from "../core/compiler.ts";
import { detectBySignals } from "../core/detect.ts";
import type { AgentAdapter } from "./types.ts";

export const antigravityAdapter: AgentAdapter = {
  id: "antigravity",
  displayName: "Antigravity",
  detect(root) {
    return detectBySignals(root, {
      id: "antigravity",
      displayName: "Antigravity",
      binaries: ["agy", "antigravity"],
      projectPaths: [".agents/rules", ".agents/workflows"],
    });
  },
  render(context) {
    if (!hasProjectContext(context)) {
      return [];
    }

    const content = renderFullContext(context, "Google Agent Project Context");

    return [
      {
        type: "managed-block",
        path: "GEMINI.md",
        content,
        marker: "poko",
        commentStyle: "html",
        label: "Antigravity workspace context",
      },
      {
        type: "replace",
        path: ".agents/rules/poko.md",
        content: `---
description: Poko project context. Use whenever working in this repository.
alwaysApply: true
---

${content}`,
        label: "Antigravity workspace rule",
      },
    ];
  },
};
