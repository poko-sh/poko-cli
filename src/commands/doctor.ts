import path from "node:path";
import { ADAPTERS } from "../adapters/index.ts";
import {
  loadPokoContext,
  POKO_DIR,
  type PokoContext,
  pathExists,
} from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { HISTORY_IMPORTERS } from "../history/importers/index.ts";
import { formatNativeDetails } from "../history/native/format.ts";
import { syncNativeHistoryTargets } from "../history/native/index.ts";
import { buildProjectHistorySync } from "../history/project-sync.ts";

export type DoctorOptions = {
  cwd: string;
  logger: Logger;
};

export const runDoctor = async (options: DoctorOptions): Promise<void> => {
  const root = path.resolve(options.cwd);

  options.logger.plain("poko doctor");

  if (!(await pathExists(path.join(root, POKO_DIR, "poko.json")))) {
    options.logger.warn("this project is not initialized. Run `poko init`.");
    return;
  }

  const context = await loadPokoContext(root);
  const enabledAdapters = ADAPTERS.filter(
    (adapter) => context.config.adapters[adapter.id].enabled,
  );
  const detections = await Promise.all(
    ADAPTERS.map(async (adapter) => ({
      adapter,
      detection: await adapter.detect(context.root),
      enabled: context.config.adapters[adapter.id].enabled,
    })),
  );
  const historySnapshot = await buildProjectHistorySync({
    root: context.root,
    config: context.config,
    targetAgents: [],
    dryRun: true,
  });
  const nativeTargets = await syncNativeHistoryTargets({
    root: context.root,
    config: context.config,
    targetAgents: enabledAdapters.map((adapter) => adapter.id),
    sessions: historySnapshot.sessions,
    dryRun: true,
  });

  reportProject(context, options.logger);
  await reportSourceContext(context, options.logger);
  reportAdapters(detections, options.logger);
  reportHistory(context, historySnapshot, options.logger);
  reportNativeTargets(nativeTargets, options.logger);
  reportWarnings(context, options.logger);
};

const reportProject = (context: PokoContext, logger: Logger): void => {
  logger.plain("\nProject");
  logger.plain(`  root: ${context.root}`);
  logger.plain(`  project id: ${context.config.project.id || "(unset)"}`);
  logger.plain(`  created: ${context.config.project.createdAt || "(unset)"}`);
  logger.plain(`  history store: ${context.config.history.defaultStore}`);
  logger.plain(
    `  history on sync: ${context.config.history.syncOnProjectSync ? "enabled" : "disabled"}`,
  );
};

const reportSourceContext = async (
  context: PokoContext,
  logger: Logger,
): Promise<void> => {
  logger.plain("\nSource Context");

  for (const [fileName, content] of Object.entries(context.sections)) {
    logger.plain(
      `  ${fileName}.md: ${await sourceState(context, `${fileName}.md`, content)}`,
    );
  }

  logger.plain(
    `  mcp.json: ${await sourceState(
      context,
      "mcp.json",
      Object.keys(context.mcpServers).length > 0 ? "servers" : "",
    )} (${Object.keys(context.mcpServers).length} server(s))`,
  );
  logger.plain(`  skills: ${context.skills.length} skill(s)`);
};

const sourceState = async (
  context: PokoContext,
  fileName: string,
  content: string,
): Promise<string> => {
  const present = await pathExists(path.join(context.pokoDir, fileName));

  if (!present) {
    return "missing";
  }

  return content.trim().length > 0 ? "present" : "empty";
};

const reportAdapters = (
  detections: Array<{
    adapter: (typeof ADAPTERS)[number];
    detection: Awaited<ReturnType<(typeof ADAPTERS)[number]["detect"]>>;
    enabled: boolean;
  }>,
  logger: Logger,
): void => {
  logger.plain("\nAdapters");

  for (const { adapter, detection, enabled } of detections) {
    const status = enabled ? "enabled" : "disabled";
    const detected = detection.detected ? "detected" : "not detected";
    const reasons =
      detection.reasons.length > 0 ? ` (${detection.reasons.join("; ")})` : "";
    logger.plain(
      `  ${adapter.id}: ${status}, ${detected} - ${adapter.displayName}${reasons}`,
    );
  }
};

const reportHistory = (
  context: PokoContext,
  snapshot: Awaited<ReturnType<typeof buildProjectHistorySync>>,
  logger: Logger,
): void => {
  logger.plain("\nHistory Capture");
  logger.plain(`  current sessions: ${snapshot.sessions.length}`);
  logger.plain(`  skipped older sessions: ${snapshot.skipped.length}`);

  for (const importer of HISTORY_IMPORTERS) {
    const enabled = context.config.history.agents[importer.id];
    const count = snapshot.sessions.filter(
      (session) => session.sourceAgent === importer.id,
    ).length;
    logger.plain(
      `  ${importer.id}: ${enabled ? "enabled" : "disabled"}, ${count} current session(s)`,
    );
  }
};

const reportNativeTargets = (
  targets: Awaited<ReturnType<typeof syncNativeHistoryTargets>>,
  logger: Logger,
): void => {
  logger.plain("\nNative Sync Dry Run");

  if (targets.length === 0) {
    logger.plain("  no native sync targets enabled");
    return;
  }

  for (const target of targets) {
    const action = target.skipped
      ? `skipped (${target.reason ?? "unknown reason"})`
      : `would sync ${target.sessions} session(s), ${target.messages} message(s)`;
    const details = formatNativeDetails(target.details);

    logger.plain(`  ${target.target}: ${action}`);
    logger.plain(`    location: ${target.location}`);

    if (details) {
      logger.plain(`    details: ${details}`);
    }
  }
};

const reportWarnings = (context: PokoContext, logger: Logger): void => {
  logger.plain("\nWarnings");

  if (context.warnings.length === 0) {
    logger.plain("  none");
    return;
  }

  for (const warning of context.warnings) {
    logger.plain(`  ${warning}`);
  }
};
