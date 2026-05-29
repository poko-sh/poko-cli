import type { PokoConfig, PokoContext } from "../core/config.ts";

export const AGENT_IDS = [
  "claude",
  "cursor",
  "antigravity",
  "copilot",
  "t3code",
  "opencode",
  "pi",
  "codex",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

const AGENT_ALIASES: Record<string, AgentId> = {
  ag: "antigravity",
  agy: "antigravity",
  google: "antigravity",
  "github-copilot": "copilot",
  oc: "opencode",
  "open-code": "opencode",
  "pi-coding-agent": "pi",
  t3: "t3code",
  "t3-code": "t3code",
  vscode: "copilot",
};

export const resolveAgentId = (value: string): AgentId | undefined => {
  const normalized = value.toLowerCase();

  if (AGENT_IDS.includes(normalized as AgentId)) {
    return normalized as AgentId;
  }

  return AGENT_ALIASES[normalized];
};

export const supportedAgentList = (): string => AGENT_IDS.join(", ");

export type AgentDetection = {
  id: AgentId;
  displayName: string;
  detected: boolean;
  reasons: string[];
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type FileOperation =
  | {
      type: "managed-block";
      path: string;
      content: string;
      marker: string;
      commentStyle: "html" | "hash";
      label: string;
    }
  | {
      type: "replace";
      path: string;
      content: string;
      label: string;
    }
  | {
      type: "json-merge";
      path: string;
      merge: JsonObject;
      arrayUnion?: Record<string, string[]>;
      label: string;
    };

export type AdapterOptions = {
  config: PokoConfig;
};

export type AgentAdapter = {
  id: AgentId;
  displayName: string;
  detect(root: string): Promise<AgentDetection>;
  render(context: PokoContext, options: AdapterOptions): FileOperation[];
  validate?(context: PokoContext, options: AdapterOptions): string[];
};
