import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { cursorAdapter } from "./cursor.ts";
import { hermesAdapter } from "./hermes.ts";
import { openClawAdapter } from "./openclaw.ts";
import { openCodeAdapter } from "./opencode.ts";
import { piAdapter } from "./pi.ts";
import { t3CodeAdapter } from "./t3code.ts";
import type { AgentAdapter, AgentId } from "./types.ts";

export const ADAPTERS: AgentAdapter[] = [
  claudeAdapter,
  cursorAdapter,
  t3CodeAdapter,
  openCodeAdapter,
  piAdapter,
  hermesAdapter,
  openClawAdapter,
  codexAdapter,
];

export const getAdapter = (id: AgentId): AgentAdapter | undefined =>
  ADAPTERS.find((adapter) => adapter.id === id);
