import { renderConventions } from "../core/compiler.ts";
import { detectBySignals } from "../core/detect.ts";
import type { AgentAdapter, FileOperation } from "./types.ts";

export const aiderAdapter: AgentAdapter = {
  id: "aider",
  displayName: "Aider",
  detect(root) {
    return detectBySignals(root, {
      id: "aider",
      displayName: "Aider",
      binaries: ["aider"],
      projectPaths: [".aider.conf.yml", "CONVENTIONS.md"],
    });
  },
  render(context) {
    const content = renderConventions(context);

    if (!content) {
      return [];
    }

    const operations: FileOperation[] = [
      {
        type: "managed-block",
        path: "CONVENTIONS.md",
        content,
        marker: "poko",
        commentStyle: "html",
        label: "Aider conventions",
      },
      {
        type: "yaml-read-list",
        path: ".aider.conf.yml",
        readFiles: ["CONVENTIONS.md"],
        label: "Aider read config",
      },
    ];

    return operations;
  },
};
