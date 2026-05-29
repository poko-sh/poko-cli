import type { HistoryAgent, HistoryImporter } from "../types.ts";
import { claudeImporter } from "./claude.ts";
import { codexImporter } from "./codex.ts";
import { cursorImporter } from "./cursor.ts";
import { hermesImporter } from "./hermes.ts";
import { openClawImporter } from "./openclaw.ts";
import { piImporter } from "./pi.ts";

export const HISTORY_IMPORTERS: HistoryImporter[] = [
  codexImporter,
  claudeImporter,
  cursorImporter,
  piImporter,
  hermesImporter,
  openClawImporter,
];

export const getHistoryImporter = (
  agent: HistoryAgent,
): HistoryImporter | undefined =>
  HISTORY_IMPORTERS.find((importer) => importer.id === agent);
