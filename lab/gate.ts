import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import {
  type CommandResult,
  collectReportSnapshot,
  createLabPaths,
  defaultPokoCommand,
  formatCommandLog,
  type LabPaths,
  NATIVE_TARGET_AGENTS,
  type ReportSnapshot,
  type RunOptions,
  resetLab,
  runLabCommand,
  type ScenarioResult,
  SEED_AGENTS,
  seedLab,
  type TargetSessionSummary,
  writeReport,
  writeScenarioResult,
} from "./poko-lab.ts";

export type GateCheckStatus = "pass" | "fail" | "manual";

export type GateCheck = {
  name: string;
  status: GateCheckStatus;
  detail: string;
};

export type GateResult = {
  gatedAt: string;
  passed: boolean;
  reportPath: string;
  checks: GateCheck[];
};

const EXPECTED_GATE_SEEDED_SESSIONS = 8;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const runGate = async (options: {
  repoRoot: string;
  root?: string;
  profile?: string;
  run?: string;
  noReset?: boolean;
}): Promise<GateResult> => {
  const paths = options.noReset
    ? createLabPaths(options)
    : await resetLab({
        repoRoot: options.repoRoot,
        root: options.root,
        profile: options.profile,
        run: options.run,
      });
  await seedLab({
    root: options.root,
    profile: options.profile,
    run: options.run,
    agents: SEED_AGENTS,
  });

  const before = await collectReportSnapshot(paths);
  const commands: ScenarioResult["commands"] = [];
  const startedAt = new Date().toISOString();
  const doctorArgs = defaultPokoCommand(options.repoRoot, "doctor", "--json");
  const dryRunArgs = defaultPokoCommand(
    options.repoRoot,
    "sync",
    "--all",
    "--dry-run",
    "--json",
  );
  const writeArgs = defaultPokoCommand(
    options.repoRoot,
    "sync",
    "--all",
    "--json",
  );
  const recaptureArgs = defaultPokoCommand(
    options.repoRoot,
    "sync",
    "--all",
    "--dry-run",
    "--json",
  );

  const doctorResult = await runGateCommand({
    ...options,
    paths,
    commands,
    label: "doctor --json",
    logFile: "gate-doctor.json",
    args: doctorArgs,
  });
  const dryRunResult = await runGateCommand({
    ...options,
    paths,
    commands,
    label: "sync --all --dry-run --json",
    logFile: "gate-sync-dry-run.json",
    args: dryRunArgs,
  });
  const writeResult = await runGateCommand({
    ...options,
    paths,
    commands,
    label: "sync --all --json",
    logFile: "gate-sync-write.json",
    args: writeArgs,
  });
  const recaptureResult = await runGateCommand({
    ...options,
    paths,
    commands,
    label: "recapture sync --all --dry-run --json",
    logFile: "gate-recapture-dry-run.json",
    args: recaptureArgs,
  });
  const after = await collectReportSnapshot(paths);
  const checks = buildGateChecks({
    after,
    doctorResult,
    dryRunResult,
    writeResult,
    recaptureResult,
  });
  const reportPath = path.join(paths.reportDir, "index.html");
  const gateResult: GateResult = {
    gatedAt: new Date().toISOString(),
    passed: checks.every((check) => check.status !== "fail"),
    reportPath,
    checks,
  };

  await writeScenarioResult(paths, {
    name: "gate",
    mode: "write",
    startedAt,
    finishedAt: gateResult.gatedAt,
    sources: SEED_AGENTS,
    targets: NATIVE_TARGET_AGENTS,
    commands,
    before,
    after,
    notes: [
      "Paid-launch gate: reset, seed feature-rich sessions, dry-run sync, write sync, recapture dry-run, and fail on storage parity regressions.",
    ],
  });
  await writeGateResult(paths, gateResult);
  await writeReport({
    root: options.root,
    profile: options.profile,
    run: options.run,
  });

  const failed = checks.filter((check) => check.status === "fail");
  const manual = checks.filter((check) => check.status === "manual");
  console.log(
    `${pc.green("poko-lab")} gate ${gateResult.passed ? "passed" : "failed"}: ${checks.length - failed.length - manual.length} pass, ${manual.length} manual, ${failed.length} fail.`,
  );

  if (failed.length > 0) {
    throw new Error(
      `Launch gate failed. See ${path.join(paths.reportDir, "gate-results.json")}.`,
    );
  }

  return gateResult;
};

const runGateCommand = async (
  options: RunOptions & {
    paths: LabPaths;
    commands: ScenarioResult["commands"];
    label: string;
    logFile: string;
  },
): Promise<CommandResult> => {
  const result = await runLabCommand({
    repoRoot: options.repoRoot,
    root: options.root,
    profile: options.profile,
    run: options.run,
    capture: true,
    args: options.args,
  });

  await mkdir(options.paths.reportDir, { recursive: true });
  await writeFile(
    path.join(options.paths.reportDir, options.logFile),
    formatCommandLog(options.args, result),
    "utf8",
  );
  options.commands.push({
    label: options.label,
    args: options.args,
    exitCode: result.exitCode,
    logFile: options.logFile,
  });

  return result;
};

const buildGateChecks = (input: {
  after: ReportSnapshot;
  doctorResult: CommandResult;
  dryRunResult: CommandResult;
  writeResult: CommandResult;
  recaptureResult: CommandResult;
}): GateCheck[] => {
  const doctorJson = parseCommandJson(input.doctorResult);
  const dryRunJson = parseCommandJson(input.dryRunResult);
  const writeJson = parseCommandJson(input.writeResult);
  const recaptureJson = parseCommandJson(input.recaptureResult);
  const writeTargets = nativeTargetsFromSyncJson(writeJson);
  const recaptureSessions = sessionsFromSyncJson(recaptureJson);
  const checks: GateCheck[] = [
    gateCheck(
      "doctor command",
      input.doctorResult.exitCode === 0 && Boolean(doctorJson),
      `exit ${input.doctorResult.exitCode}`,
    ),
    gateCheck(
      "dry-run command",
      input.dryRunResult.exitCode === 0 && Boolean(dryRunJson),
      `exit ${input.dryRunResult.exitCode}`,
    ),
    gateCheck(
      "write command",
      input.writeResult.exitCode === 0 && Boolean(writeJson),
      `exit ${input.writeResult.exitCode}`,
    ),
    gateCheck(
      "recapture command",
      input.recaptureResult.exitCode === 0 && Boolean(recaptureJson),
      `exit ${input.recaptureResult.exitCode}`,
    ),
    gateCheck(
      "seeded session count",
      recaptureSessions.length === EXPECTED_GATE_SEEDED_SESSIONS,
      `${recaptureSessions.length}/${EXPECTED_GATE_SEEDED_SESSIONS} current sessions after recapture`,
    ),
    gateCheck(
      "captured feature fixture",
      input.after.featureMatrix.every((row) => row.captured),
      `${input.after.featureMatrix.filter((row) => row.captured).length}/${input.after.featureMatrix.length} captured feature checks`,
    ),
    gateCheck(
      "no duplicate target imports",
      duplicateTargetTitles(input.after.targetSessions).length === 0,
      duplicateTargetTitles(input.after.targetSessions).join(", ") ||
        "target titles are unique",
    ),
  ];

  for (const target of NATIVE_TARGET_AGENTS) {
    const parity = input.after.conversationParity.find(
      (row) => row.target === target,
    );
    const nativeTarget = writeTargets.find((row) => row.target === target);
    checks.push(
      gateCheck(
        `${target} storage parity`,
        parity?.storageStatus === "pass",
        parity
          ? `${parity.featureCount}/${parity.featureTotal} features, ${parity.importedSessions} imported session(s)`
          : "missing parity row",
      ),
      gateCheck(
        `${target} write result`,
        Boolean(
          nativeTarget && !nativeTarget.skipped && nativeTarget.sessions > 0,
        ),
        nativeTarget
          ? `${nativeTarget.sessions} session(s), skipped=${nativeTarget.skipped}${nativeTarget.reason ? `, ${nativeTarget.reason}` : ""}`
          : "missing native target result",
      ),
    );
  }

  checks.push({
    name: "real app visual confirmation",
    status: "manual",
    detail:
      "Run `bun lab/poko-lab.ts accept --prepare --agent codex,claude,cursor,t3code` and attach screenshots under ~/.poko/lab when doing a real-app pass.",
  });

  return checks;
};

const gateCheck = (
  name: string,
  condition: boolean,
  detail: string,
): GateCheck => ({
  name,
  status: condition ? "pass" : "fail",
  detail,
});

const parseCommandJson = (result: CommandResult): unknown => {
  if (result.exitCode !== 0) {
    return undefined;
  }

  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    return undefined;
  }
};

const nativeTargetsFromSyncJson = (
  value: unknown,
): Array<{
  target: string;
  sessions: number;
  skipped: boolean;
  reason?: string;
}> => {
  if (!isRecord(value) || !isRecord(value.history)) {
    return [];
  }

  const nativeTargets = value.history.nativeTargets;
  if (!Array.isArray(nativeTargets)) {
    return [];
  }

  return nativeTargets.filter(isRecord).map((target) => ({
    target: typeof target.target === "string" ? target.target : "",
    sessions: typeof target.sessions === "number" ? target.sessions : 0,
    skipped: Boolean(target.skipped),
    reason: typeof target.reason === "string" ? target.reason : undefined,
  }));
};

const sessionsFromSyncJson = (value: unknown): unknown[] => {
  if (!isRecord(value) || !isRecord(value.history)) {
    return [];
  }

  return Array.isArray(value.history.sessions) ? value.history.sessions : [];
};

const duplicateTargetTitles = (sessions: TargetSessionSummary[]): string[] => {
  const counts = new Map<string, number>();

  for (const session of sessions) {
    const key = `${session.target}:${session.title}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => `${key} x${count}`);
};
const writeGateResult = async (
  paths: LabPaths,
  result: GateResult,
): Promise<void> => {
  await mkdir(paths.reportDir, { recursive: true });
  await writeFile(
    path.join(paths.reportDir, "gate-results.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
};
