import type { AgentId } from "../../adapters/types.ts";
import { claudeNativeSyncer } from "./claude.ts";
import { codexNativeSyncer } from "./codex.ts";
import { cursorNativeSyncer } from "./cursor.ts";
import { hermesNativeSyncer } from "./hermes.ts";
import { openClawNativeSyncer } from "./openclaw.ts";
import { openCodeNativeSyncer } from "./opencode.ts";
import { piNativeSyncer } from "./pi.ts";
import { t3CodeNativeSyncer } from "./t3code.ts";
import type {
  NativeHistorySyncer,
  NativeHistorySyncOptions,
  NativeHistorySyncResult,
} from "./types.ts";

const NATIVE_HISTORY_SYNCERS: NativeHistorySyncer[] = [
  claudeNativeSyncer,
  cursorNativeSyncer,
  t3CodeNativeSyncer,
  openCodeNativeSyncer,
  piNativeSyncer,
  hermesNativeSyncer,
  openClawNativeSyncer,
  codexNativeSyncer,
];

export const syncNativeHistoryTargets = async (
  options: {
    targetAgents: AgentId[];
  } & NativeHistorySyncOptions,
): Promise<NativeHistorySyncResult[]> => {
  const targetSet = new Set(options.targetAgents);
  const results: NativeHistorySyncResult[] = [];

  for (const syncer of NATIVE_HISTORY_SYNCERS) {
    if (!targetSet.has(syncer.id)) {
      continue;
    }

    results.push(await syncer.sync(options));
  }

  return results;
};

export type { NativeHistorySyncResult };
