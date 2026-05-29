import { antigravityAdapter } from "./antigravity.ts";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { copilotAdapter } from "./copilot.ts";
import { cursorAdapter } from "./cursor.ts";
import { openCodeAdapter } from "./opencode.ts";
import { piAdapter } from "./pi.ts";
import { t3CodeAdapter } from "./t3code.ts";
import type { AgentAdapter, AgentId } from "./types.ts";

export const ADAPTERS: AgentAdapter[] = [
  claudeAdapter,
  cursorAdapter,
  antigravityAdapter,
  copilotAdapter,
  t3CodeAdapter,
  openCodeAdapter,
  piAdapter,
  codexAdapter,
];

export const getAdapter = (id: AgentId): AgentAdapter | undefined =>
  ADAPTERS.find((adapter) => adapter.id === id);
