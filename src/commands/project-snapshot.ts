import type { ADAPTERS } from "../adapters/index.ts";
import type { PokoContext } from "../core/config.ts";
import { type SourceState, sourceState } from "../core/source-state.ts";

export type AdapterDetectionRow = {
  adapter: (typeof ADAPTERS)[number];
  detection: Awaited<ReturnType<(typeof ADAPTERS)[number]["detect"]>>;
  enabled: boolean;
};

export type ProjectSnapshot = {
  project: {
    root: string;
    id: string;
    createdAt: string;
    historyStore: string;
    historyOnSync: boolean;
  };
  sourceContext: {
    text: Record<keyof PokoContext["sections"], SourceState>;
    mcp: { state: SourceState; servers: number };
    skills: number;
  };
  adapters: Array<{
    id: string;
    displayName: string;
    enabled: boolean;
    detected: boolean;
    reasons: string[];
  }>;
};

export const buildProjectSnapshot = async (
  context: PokoContext,
  detections: AdapterDetectionRow[],
): Promise<ProjectSnapshot> => {
  const textStates = {} as Record<keyof PokoContext["sections"], SourceState>;

  for (const [fileName, content] of Object.entries(context.sections) as Array<
    [keyof PokoContext["sections"], string]
  >) {
    textStates[fileName] = await sourceState(
      context,
      `${fileName}.md`,
      content,
    );
  }

  return {
    project: {
      root: context.root,
      id: context.config.project.id,
      createdAt: context.config.project.createdAt,
      historyStore: context.config.history.defaultStore,
      historyOnSync: context.config.history.syncOnProjectSync,
    },
    sourceContext: {
      text: textStates,
      mcp: {
        state: await sourceState(
          context,
          "mcp.json",
          Object.keys(context.mcpServers).length > 0 ? "servers" : "",
        ),
        servers: Object.keys(context.mcpServers).length,
      },
      skills: context.skills.length,
    },
    adapters: detections.map(({ adapter, detection, enabled }) => ({
      id: adapter.id,
      displayName: adapter.displayName,
      enabled,
      detected: detection.detected,
      reasons: detection.reasons,
    })),
  };
};
