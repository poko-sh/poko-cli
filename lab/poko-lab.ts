#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import {
  appendFile,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pc from "picocolors";
import type { AgentId } from "../src/adapters/types.ts";
import type { HistoryAgent } from "../src/history/types.ts";
import { type GateResult, runGate } from "./gate.ts";

export { type GateResult, runGate };

type ParsedArgs = {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
};

export type LabPaths = {
  root: string;
  profile: string;
  run: string;
  profileDir: string;
  baselineHome: string;
  runDir: string;
  runHome: string;
  workspaceRoot: string;
  projectDir: string;
  reportDir: string;
};

type ResetOptions = {
  repoRoot: string;
  root?: string;
  profile?: string;
  run?: string;
  includeAuth?: boolean;
  yes?: boolean;
};

type SnapshotOptions = {
  root?: string;
  profile?: string;
  run?: string;
  force?: boolean;
};

type ImportAuthOptions = {
  repoRoot: string;
  root?: string;
  profile?: string;
  run?: string;
  agents?: AuthAgent[];
  force?: boolean;
  reset?: boolean;
};

type ReportOptions = {
  root?: string;
  profile?: string;
  run?: string;
};

export type RunOptions = {
  repoRoot: string;
  root?: string;
  profile?: string;
  run?: string;
  args: string[];
  capture?: boolean;
  env?: Record<string, string | undefined>;
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type StoreSummary = {
  label: string;
  kind: "directory" | "file";
  path: string;
  description: string;
  exists: boolean;
  fileCount?: number;
  sampleFiles?: string[];
  sqliteTables?: Array<{ name: string; rows: number | string }>;
};

type SeedAgent = HistoryAgent;

type AuthAgent =
  | "codex"
  | "claude"
  | "cursor"
  | "t3code"
  | "opencode"
  | "pi"
  | "hermes"
  | "openclaw";

type ScenarioName =
  | "codex-to-core"
  | "claude-to-core"
  | "cursor-to-core"
  | "all-to-all"
  | "reset-modes";

type SessionSummary = {
  source: string;
  title: string;
  messages: number;
  path?: string;
};

export type TargetSessionSummary = {
  target: string;
  title: string;
  messages: number;
  location: string;
};

export type ReportSnapshot = {
  capturedSessions: SessionSummary[];
  targetSessions: TargetSessionSummary[];
  storeCounts: Record<string, number | string>;
  featureMatrix: FeatureMatrixRow[];
  conversationParity: ConversationParityRow[];
};

type FeatureMatrixRow = {
  feature: string;
  needle: string;
  captured: boolean;
  targets: Record<string, boolean>;
};

type ConversationParityRow = {
  target: string;
  importedSessions: number;
  featureCount: number;
  featureTotal: number;
  storageStatus: "pass" | "partial" | "missing";
  visualStatus: "verified" | "manual" | "not checked";
  continuationStatus: "ready" | "manual" | "not checked";
  notes: string[];
};

export type ScenarioResult = {
  name: string;
  mode: "dry-run" | "write";
  startedAt: string;
  finishedAt: string;
  sources: string[];
  targets: string[];
  commands: Array<{
    label: string;
    args: string[];
    exitCode: number;
    logFile: string;
  }>;
  before: ReportSnapshot;
  after: ReportSnapshot;
  notes: string[];
};

type AcceptanceStatus = "pass" | "fail" | "skip" | "manual";

type AcceptanceResult = {
  agent: string;
  surface: "cli" | "tui" | "gui" | "storage";
  status: AcceptanceStatus;
  command?: string;
  logFile?: string;
  expectedTitles: string[];
  observed?: string;
  notes: string[];
};

type AcceptanceReport = {
  acceptedAt: string;
  prepared: boolean;
  results: AcceptanceResult[];
};

const DEFAULT_PROFILE = "default";
const DEFAULT_RUN = "current";
const PROJECT_DIR_NAME = "poko";
export const SEED_AGENTS: SeedAgent[] = [
  "codex",
  "claude",
  "cursor",
  "pi",
  "hermes",
  "openclaw",
];
export const NATIVE_TARGET_AGENTS: AgentId[] = [
  "claude",
  "cursor",
  "t3code",
  "opencode",
  "pi",
  "hermes",
  "openclaw",
  "codex",
];
const ACCEPTANCE_AGENTS = [
  "codex",
  "claude",
  "cursor",
  "t3code",
  "opencode",
  "pi",
  "hermes",
  "openclaw",
] as const;
type AcceptanceAgent = (typeof ACCEPTANCE_AGENTS)[number];
const AUTH_AGENTS: AuthAgent[] = [
  "codex",
  "claude",
  "cursor",
  "t3code",
  "opencode",
  "pi",
  "hermes",
  "openclaw",
];
const SCENARIOS: Record<
  Exclude<ScenarioName, "reset-modes">,
  { sources: SeedAgent[]; targets: AgentId[]; description: string }
> = {
  "codex-to-core": {
    sources: ["codex"],
    targets: ["claude", "cursor", "t3code"],
    description:
      "Seed a Codex conversation and sync it into Claude, Cursor, and T3 Code.",
  },
  "claude-to-core": {
    sources: ["claude"],
    targets: ["cursor", "t3code"],
    description:
      "Seed a Claude Code conversation and sync it into Cursor and T3 Code.",
  },
  "cursor-to-core": {
    sources: ["cursor"],
    targets: ["claude", "t3code"],
    description:
      "Seed a Cursor conversation and sync it into Claude and T3 Code.",
  },
  "all-to-all": {
    sources: SEED_AGENTS,
    targets: NATIVE_TARGET_AGENTS,
    description:
      "Seed every supported source importer and sync into every native target.",
  },
};
const FEATURE_RELATIVE_PATH = ".poko/poko.json:45";
const FEATURE_RELATIVE_FILE = ".poko/poko.json";
const FEATURE_THINKING =
  "[thinking] inspect the project registry before editing";
const FEATURE_THINKING_TEXT = "inspect the project registry before editing";
const FEATURE_TOOL_CALL = "[tool_use:Read]";
const FEATURE_TOOL_RESULT = "Tool result: schemaVersion=1";
const FEATURE_TOOL_RESULT_TEXT = "schemaVersion=1";
const FEATURE_ASSISTANT_TEXT =
  "Feature matrix response: file path, reasoning marker, and tool marker preserved.";
const FEATURE_USER_TEXT =
  "Feature fixture: inspect .poko/poko.json:45 and preserve";
const FEATURE_CHECKS = [
  {
    label: "user text",
    needle: FEATURE_USER_TEXT,
    patterns: [FEATURE_USER_TEXT],
  },
  {
    label: "relative file path",
    needle: FEATURE_RELATIVE_PATH,
    patterns: [FEATURE_RELATIVE_PATH, FEATURE_RELATIVE_FILE],
  },
  {
    label: "thinking",
    needle: FEATURE_THINKING_TEXT,
    patterns: [FEATURE_THINKING, FEATURE_THINKING_TEXT],
  },
  {
    label: "tool call",
    needle: "Read",
    patterns: [
      FEATURE_TOOL_CALL,
      '"name":"Read"',
      '"name": "Read"',
      '"name":"read_file"',
      '"name": "read_file"',
      '"tool_name":"Read"',
      '"tool_name": "Read"',
      '"tool":"Read"',
      '"tool": "Read"',
      '"title":"Read"',
      '"title": "Read"',
      "read_file",
    ],
  },
  {
    label: "tool result",
    needle: FEATURE_TOOL_RESULT_TEXT,
    patterns: [FEATURE_TOOL_RESULT, FEATURE_TOOL_RESULT_TEXT],
  },
  {
    label: "assistant text",
    needle: FEATURE_ASSISTANT_TEXT,
    patterns: [FEATURE_ASSISTANT_TEXT],
  },
] as const;

const cli = async (): Promise<number> => {
  const parsed = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(process.cwd());
  const profile = flagString(parsed.flags.profile) ?? DEFAULT_PROFILE;
  const run = flagString(parsed.flags.run) ?? DEFAULT_RUN;
  const root = resolveLabRoot(flagString(parsed.flags.root));

  switch (parsed.command) {
    case undefined:
    case "help":
      console.log(helpText());
      return 0;
    case "doctor":
      await doctor({ root, profile, run });
      return 0;
    case "reset":
      await resetLab({
        repoRoot,
        root,
        profile,
        run,
        includeAuth: Boolean(parsed.flags["include-auth"]),
        yes: Boolean(parsed.flags.yes),
      });
      return 0;
    case "snapshot-auth":
      await snapshotAuth({
        root,
        profile,
        run,
        force: Boolean(parsed.flags.force),
      });
      return 0;
    case "import-auth":
      await importAuth({
        repoRoot,
        root,
        profile,
        run,
        agents: parseAuthAgents(flagString(parsed.flags.agent)),
        force: Boolean(parsed.flags.force),
        reset: Boolean(parsed.flags.reset),
      });
      return 0;
    case "env":
      await printEnv({
        root,
        profile,
        run,
        json: Boolean(parsed.flags.json),
      });
      return 0;
    case "seed":
      await seedLab({
        root,
        profile,
        run,
        agents: parseSeedAgents(flagString(parsed.flags.agent)),
      });
      return 0;
    case "scenario":
      if (parsed.positional[0] === "list") {
        printScenarios();
        return 0;
      }
      await runScenario({
        repoRoot,
        root,
        profile,
        run,
        name: parseScenarioName(parsed.positional[0] ?? "all-to-all"),
        write: Boolean(parsed.flags.write),
        noReset: Boolean(parsed.flags["no-reset"]),
        yes: Boolean(parsed.flags.yes),
      });
      return 0;
    case "accept":
      await runAcceptance({
        repoRoot,
        root,
        profile,
        run,
        agents: parseAcceptanceAgents(flagString(parsed.flags.agent)),
        prepare: Boolean(parsed.flags.prepare),
      });
      return 0;
    case "run":
      return runInLab({
        repoRoot,
        root,
        profile,
        run,
        args:
          parsed.positional.length > 0
            ? parsed.positional
            : defaultPokoCommand(repoRoot, "doctor"),
      });
    case "smoke":
      await smoke({
        repoRoot,
        root,
        profile,
        run,
        write: Boolean(parsed.flags.write),
        noReset: Boolean(parsed.flags["no-reset"]),
      });
      return 0;
    case "gate":
      await runGate({
        repoRoot,
        root,
        profile,
        run,
        noReset: Boolean(parsed.flags["no-reset"]),
      });
      return 0;
    case "report":
      await writeReport({ root, profile, run });
      return 0;
    default:
      throw new Error(
        `Unknown lab command "${parsed.command}". Run \`bun lab/poko-lab.ts help\`.`,
      );
  }
};

export const createLabPaths = (options: {
  root?: string;
  profile?: string;
  run?: string;
}): LabPaths => {
  const root = resolveLabRoot(options.root);
  const profile = options.profile ?? DEFAULT_PROFILE;
  const run = options.run ?? DEFAULT_RUN;
  const profileDir = path.join(root, "profiles", profile);
  const runDir = path.join(profileDir, "runs", run);
  const workspaceRoot = path.join(runDir, "workspace");

  return {
    root,
    profile,
    run,
    profileDir,
    baselineHome: path.join(profileDir, "baseline", "home"),
    runDir,
    runHome: path.join(runDir, "home"),
    workspaceRoot,
    projectDir: path.join(workspaceRoot, PROJECT_DIR_NAME),
    reportDir: path.join(runDir, "report"),
  };
};

export const buildLabEnv = (paths: LabPaths): Record<string, string> => {
  const cursorUserRoot = path.join(paths.runHome, ".cursor", "User");

  return {
    HOME: paths.runHome,
    XDG_CONFIG_HOME: path.join(paths.runHome, ".config"),
    XDG_DATA_HOME: path.join(paths.runHome, ".local", "share"),
    XDG_STATE_HOME: path.join(paths.runHome, ".local", "state"),
    CODEX_HOME: path.join(paths.runHome, ".codex"),
    CLAUDE_CONFIG_DIR: path.join(paths.runHome, ".claude"),
    CLAUDE_HOME: path.join(paths.runHome, ".claude"),
    HERMES_HOME: path.join(paths.runHome, ".hermes"),
    OPENCLAW_HOME: paths.runHome,
    OPENCLAW_STATE_DIR: path.join(paths.runHome, ".openclaw"),
    PI_CODING_AGENT_DIR: path.join(paths.runHome, ".pi", "agent"),
    POKO_CURSOR_STORAGE_ROOT: path.join(cursorUserRoot, "workspaceStorage"),
    POKO_CURSOR_GLOBAL_STORAGE_ROOT: path.join(cursorUserRoot, "globalStorage"),
    POKO_CURSOR_GLOBAL_STATE_DB: path.join(
      cursorUserRoot,
      "globalStorage",
      "state.vscdb",
    ),
    POKO_T3CODE_DB_PATH: path.join(
      paths.runHome,
      ".t3",
      "userdata",
      "state.sqlite",
    ),
    POKO_OPENCODE_BIN: path.join(paths.runDir, "bin", "opencode"),
    POKO_OPENCODE_IMPORT_MODEL: "opencode/big-pickle",
    POKO_LAB_OPENCODE_DB: path.join(
      paths.runHome,
      ".local",
      "state",
      "poko-lab-opencode",
      "opencode.db",
    ),
    POKO_CURSOR_SKIP_APP_LIFECYCLE: "1",
    POKO_T3CODE_SKIP_APP_LIFECYCLE: "1",
  };
};

export const resetLab = async (options: ResetOptions): Promise<LabPaths> => {
  const paths = createLabPaths(options);

  if (options.includeAuth && !options.yes) {
    throw new Error(
      "Refusing to clear auth without --yes. Use `reset --include-auth --yes` when you really want to delete the signed-in baseline.",
    );
  }

  if (options.includeAuth) {
    await rm(paths.profileDir, { recursive: true, force: true });
    await mkdir(paths.baselineHome, { recursive: true });
  }

  await rm(paths.runDir, { recursive: true, force: true });
  await mkdir(paths.runDir, { recursive: true });

  if (await pathExists(paths.baselineHome)) {
    await copyTree(paths.baselineHome, paths.runHome);
  } else {
    await mkdir(paths.runHome, { recursive: true });
  }

  await ensureLabHomeSkeleton(paths);
  await copyProjectWorkspace(options.repoRoot, paths.projectDir);

  console.log(
    `${pc.green("poko-lab")} reset ${paths.profile}/${paths.run}${options.includeAuth ? " and cleared auth baseline" : " from auth baseline"}.`,
  );
  console.log(`${pc.cyan("workspace")} ${paths.projectDir}`);
  console.log(`${pc.cyan("home")} ${paths.runHome}`);

  return paths;
};

export const snapshotAuth = async (
  options: SnapshotOptions,
): Promise<LabPaths> => {
  const paths = createLabPaths(options);

  if (!(await pathExists(paths.runHome))) {
    throw new Error(
      "No run home exists yet. Run `bun lab/poko-lab.ts reset` first, then sign in inside the lab.",
    );
  }

  if ((await directoryHasEntries(paths.baselineHome)) && !options.force) {
    throw new Error(
      "Auth baseline already exists. Re-run with --force to replace it with the current run home.",
    );
  }

  await rm(paths.baselineHome, { recursive: true, force: true });
  await copyTree(paths.runHome, paths.baselineHome);

  console.log(
    `${pc.green("poko-lab")} saved auth baseline for ${paths.profile}.`,
  );
  console.log(`${pc.cyan("baseline")} ${paths.baselineHome}`);

  return paths;
};

export const importAuth = async (
  options: ImportAuthOptions,
): Promise<LabPaths> => {
  const paths = createLabPaths(options);
  const agents = options.agents ?? AUTH_AGENTS;
  const imported: string[] = [];
  const missing: string[] = [];

  await mkdir(paths.baselineHome, { recursive: true });

  for (const agent of agents) {
    const result = await importAgentAuth(paths, agent, Boolean(options.force));
    imported.push(...result.imported);
    missing.push(...result.missing);
  }

  if (imported.length === 0) {
    console.log(`${pc.yellow("poko-lab")} no local auth state was imported.`);
  } else {
    console.log(
      `${pc.green("poko-lab")} imported local auth/profile state for ${agents.join(", ")}.`,
    );
    for (const item of imported) {
      console.log(`  ${pc.cyan("copied")} ${item}`);
    }
  }

  if (missing.length > 0) {
    console.log("");
    console.log(pc.yellow("Missing local auth sources:"));
    for (const item of missing) {
      console.log(`  ${item}`);
    }
  }

  if (options.reset) {
    await resetLab({
      repoRoot: options.repoRoot,
      root: options.root,
      profile: options.profile,
      run: options.run,
    });
  } else if (await pathExists(paths.runHome)) {
    await copyImportedAuthToRun(paths, agents, Boolean(options.force));
  }

  console.log(`${pc.cyan("baseline")} ${paths.baselineHome}`);
  console.log(
    "Copied auth remains local under the lab profile. Remove it with `bun lab/poko-lab.ts reset --include-auth --yes`.",
  );

  return paths;
};

type AuthImportResult = {
  imported: string[];
  missing: string[];
};

type AuthCopySpec = {
  source: string;
  destination: string;
  label: string;
  filter?: (relativePath: string, entryName: string) => boolean;
};

const importAgentAuth = async (
  paths: LabPaths,
  agent: AuthAgent,
  force: boolean,
): Promise<AuthImportResult> => {
  const result: AuthImportResult = { imported: [], missing: [] };

  for (const spec of authCopySpecs(agent, os.homedir(), paths.baselineHome)) {
    if (!(await pathExists(spec.source))) {
      result.missing.push(`${agent}: ${spec.label}`);
      continue;
    }

    if (force) {
      await rm(spec.destination, { recursive: true, force: true });
    } else if (await pathExists(spec.destination)) {
      result.imported.push(`${agent}: ${spec.label} (kept existing)`);
      continue;
    }

    await copyTree(spec.source, spec.destination, spec.filter);
    result.imported.push(`${agent}: ${spec.label}`);
  }

  return result;
};

const copyImportedAuthToRun = async (
  paths: LabPaths,
  agents: AuthAgent[],
  force: boolean,
): Promise<void> => {
  for (const agent of agents) {
    for (const spec of authCopySpecs(
      agent,
      paths.baselineHome,
      paths.runHome,
    )) {
      if (!(await pathExists(spec.source))) {
        continue;
      }

      if (force) {
        await rm(spec.destination, { recursive: true, force: true });
      } else if (await pathExists(spec.destination)) {
        continue;
      }

      await copyTree(spec.source, spec.destination, spec.filter);
    }
  }
};

const authCopySpecs = (
  agent: AuthAgent,
  sourceHome: string,
  destinationHome: string,
): AuthCopySpec[] => {
  switch (agent) {
    case "codex":
      return [
        authFile(sourceHome, destinationHome, ".codex/auth.json"),
        authFile(sourceHome, destinationHome, ".codex/config.toml"),
        authFile(
          sourceHome,
          destinationHome,
          ".codex/.codex-global-state.json",
        ),
        authFile(sourceHome, destinationHome, ".codex/installation_id"),
        authFile(sourceHome, destinationHome, ".codex/state_5.sqlite"),
      ];
    case "claude":
      return [
        {
          source: path.join(sourceHome, ".claude"),
          destination: path.join(destinationHome, ".claude"),
          label: "~/.claude profile",
          filter: shouldCopyClaudeAuthPath,
        },
        authFile(sourceHome, destinationHome, ".claude.json"),
        {
          source: path.join(sourceHome, ".claude.json"),
          destination: path.join(destinationHome, ".claude", ".claude.json"),
          label: "~/.claude.json as CLAUDE_CONFIG_DIR config",
        },
        authFile(sourceHome, destinationHome, ".claude.json.backup"),
      ];
    case "cursor":
      return [
        {
          source: path.join(
            sourceHome,
            "Library",
            "Application Support",
            "Cursor",
          ),
          destination: path.join(destinationHome, ".cursor"),
          label: "Cursor application profile",
          filter: shouldCopyCursorAuthPath,
        },
      ];
    case "t3code":
      return [
        authFile(sourceHome, destinationHome, ".t3/userdata/secrets"),
        authFile(sourceHome, destinationHome, ".t3/userdata/environment-id"),
        authFile(sourceHome, destinationHome, ".t3/userdata/settings.json"),
        authFile(
          sourceHome,
          destinationHome,
          ".t3/userdata/client-settings.json",
        ),
      ];
    case "opencode":
      return [
        authFile(
          sourceHome,
          destinationHome,
          ".local/share/opencode/auth.json",
        ),
        authFile(
          sourceHome,
          destinationHome,
          ".local/share/opencode/mcp-auth.json",
        ),
        authFile(sourceHome, destinationHome, ".config/opencode/opencode.json"),
        authFile(
          sourceHome,
          destinationHome,
          ".config/opencode/oh-my-openagent.json",
        ),
      ];
    case "pi":
      return [
        authFile(sourceHome, destinationHome, ".pi/agent/auth.json"),
        authFile(sourceHome, destinationHome, ".pi/agent/config.json"),
        authFile(sourceHome, destinationHome, ".pi/agent/settings.json"),
      ];
    case "hermes":
      return [
        authFile(sourceHome, destinationHome, ".hermes/auth.json"),
        authFile(sourceHome, destinationHome, ".hermes/config.yaml"),
        authFile(sourceHome, destinationHome, ".hermes/pairing"),
      ];
    case "openclaw":
      return [
        authFile(sourceHome, destinationHome, ".openclaw/auth.json"),
        authFile(sourceHome, destinationHome, ".openclaw/config.json"),
        authFile(sourceHome, destinationHome, ".config/openclaw/auth.json"),
        authFile(sourceHome, destinationHome, ".config/openclaw/config.json"),
      ];
  }
};

const authFile = (
  sourceHome: string,
  destinationHome: string,
  relativePath: string,
): AuthCopySpec => ({
  source: path.join(sourceHome, relativePath),
  destination: path.join(destinationHome, relativePath),
  label: `~/${relativePath}`,
});

const shouldCopyClaudeAuthPath = (
  relativePath: string,
  entryName: string,
): boolean => {
  const skippedNames = new Set([
    "debug",
    "downloads",
    "image-cache",
    "logs",
    "paste-cache",
    "projects",
    "sessions",
    "shell-snapshots",
    "statsig",
    "tasks",
    "todos",
    "transcripts",
  ]);
  const skippedPrefixes = ["plugins/cache/"];

  if (skippedPrefixes.some((prefix) => relativePath.startsWith(prefix))) {
    return false;
  }

  return entryName === ".credentials.json" || !skippedNames.has(entryName);
};

const shouldCopyCursorAuthPath = (
  relativePath: string,
  entryName: string,
): boolean => {
  const skippedNames = new Set([
    "Cache",
    "CachedData",
    "Code Cache",
    "Crashpad",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "GPUCache",
    "logs",
    "process-monitor",
  ]);

  if (skippedNames.has(entryName)) {
    return false;
  }

  if (relativePath === "User") {
    return true;
  }

  if (relativePath.startsWith("User/")) {
    return (
      relativePath === "User/settings.json" ||
      relativePath === "User/keybindings.json" ||
      relativePath === "User/globalStorage" ||
      relativePath.startsWith("User/globalStorage/")
    );
  }

  return true;
};

const doctor = async (options: ReportOptions): Promise<void> => {
  const paths = createLabPaths(options);
  const baselineReady = await directoryHasEntries(paths.baselineHome);
  const runReady = await pathExists(paths.runHome);
  const workspaceReady = await pathExists(paths.projectDir);

  console.log(pc.bold("poko lab"));
  console.log(`root: ${paths.root}`);
  console.log(`profile: ${paths.profile}`);
  console.log(`run: ${paths.run}`);
  console.log(
    `auth baseline: ${baselineReady ? "ready" : "empty"} (${paths.baselineHome})`,
  );
  console.log(`run home: ${runReady ? "ready" : "missing"} (${paths.runHome})`);
  console.log(
    `workspace: ${workspaceReady ? "ready" : "missing"} (${paths.projectDir})`,
  );
  console.log("");
  console.log("Common commands:");
  console.log("  bun lab/poko-lab.ts reset");
  console.log("  bun lab/poko-lab.ts env");
  console.log("  bun lab/poko-lab.ts run -- bun src/cli.ts doctor");
  console.log("  bun lab/poko-lab.ts smoke");
  console.log("  bun lab/poko-lab.ts snapshot-auth --force");
  console.log("");
  console.log("Reset levels:");
  console.log(
    "  reset                       clears test data, preserves signed-in baseline",
  );
  console.log(
    "  reset --include-auth --yes  clears test data and login/auth state",
  );
};

const printEnv = async (
  options: ReportOptions & { json?: boolean },
): Promise<void> => {
  const paths = createLabPaths(options);
  const env = buildLabEnv(paths);

  if (options.json) {
    console.log(JSON.stringify(env, null, 2));
    return;
  }

  for (const [key, value] of Object.entries(env)) {
    console.log(`export ${key}=${shellQuote(value)}`);
  }
  console.log(`cd ${shellQuote(paths.projectDir)}`);
};

export const seedLab = async (options: {
  root?: string;
  profile?: string;
  run?: string;
  agents?: SeedAgent[];
}): Promise<LabPaths> => {
  const paths = createLabPaths(options);

  if (!(await pathExists(paths.projectDir))) {
    throw new Error(
      "No lab workspace exists yet. Run `bun lab/poko-lab.ts reset` first.",
    );
  }

  const agents = options.agents ?? SEED_AGENTS;
  await ensureLabHomeSkeleton(paths);
  await prepareSeedProject(paths);

  for (const agent of agents) {
    await seedAgentHistory(paths, agent);
  }

  await mkdir(paths.reportDir, { recursive: true });
  await writeFile(
    path.join(paths.reportDir, "seed.json"),
    `${JSON.stringify(
      {
        seededAt: new Date().toISOString(),
        agents,
        projectRoot: paths.projectDir,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    `${pc.green("poko-lab")} seeded ${agents.length} source agent(s): ${agents.join(", ")}.`,
  );
  return paths;
};

const prepareSeedProject = async (paths: LabPaths): Promise<void> => {
  const configPath = path.join(paths.projectDir, ".poko", "poko.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as Record<
    string,
    unknown
  >;
  const history = isRecord(config.history) ? config.history : {};
  const adapters = isRecord(config.adapters) ? config.adapters : {};

  config.project = {
    ...(isRecord(config.project) ? config.project : {}),
    id: "poko-lab-project",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  config.history = {
    ...history,
    defaultStore: "repo",
    syncOnProjectSync: true,
    agents: {
      codex: true,
      claude: true,
      cursor: true,
      pi: true,
      hermes: true,
      openclaw: true,
    },
  };
  config.adapters = {
    ...adapters,
    claude: { enabled: true, mcp: true, skills: true },
    cursor: { enabled: true, mcp: true, legacyCursorrules: false },
    t3code: { enabled: true, skills: true },
    opencode: { enabled: true, mcp: true },
    pi: { enabled: true, skills: true },
    hermes: { enabled: true, skills: true },
    openclaw: { enabled: true, skills: true },
    codex: { enabled: true, mcp: true },
  };

  await mkdir(path.join(paths.projectDir, ".poko"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(paths.projectDir, ".poko", "rules.md"),
    "# Lab Rules\n\nPreserve Poko's seeded conversation context exactly.\n",
    "utf8",
  );
  await writeFile(
    path.join(paths.projectDir, ".poko", "mcp.json"),
    `${JSON.stringify(
      {
        mcpServers: {
          "poko-lab-docs": {
            url: "https://example.com/poko-lab/mcp",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
};

const seedAgentHistory = async (
  paths: LabPaths,
  agent: SeedAgent,
): Promise<void> => {
  switch (agent) {
    case "codex":
      await seedCodexSource(paths);
      return;
    case "claude":
      await seedClaudeSource(paths);
      return;
    case "cursor":
      await seedCursorSource(paths);
      return;
    case "pi":
      await seedPiSource(paths);
      return;
    case "hermes":
      await seedHermesSource(paths);
      return;
    case "openclaw":
      await seedOpenClawSource(paths);
      return;
  }
};

const seedCodexSource = async (paths: LabPaths): Promise<void> => {
  const env = buildLabEnv(paths);
  const id = "lab-codex-session";
  const createdAt = "2026-05-29T09:00:00.000Z";
  const sessionPath = path.join(
    env.CODEX_HOME,
    "sessions",
    "2026",
    "05",
    "29",
    "rollout-2026-05-29T09-00-00-lab-codex-session.jsonl",
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    renderJsonl([
      {
        timestamp: createdAt,
        type: "session_meta",
        payload: {
          id,
          timestamp: createdAt,
          cwd: paths.projectDir,
        },
      },
      {
        timestamp: "2026-05-29T09:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Codex source: port this project context everywhere.",
        },
      },
      {
        timestamp: "2026-05-29T09:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "Codex source synced with project rules and chat history.",
        },
      },
    ]),
    "utf8",
  );
  await appendFile(
    path.join(env.CODEX_HOME, "session_index.jsonl"),
    `${JSON.stringify({ id, thread_name: "Lab Codex source" })}\n`,
    "utf8",
  );
  await seedCodexFeatureSource(paths);
};

const seedCodexFeatureSource = async (paths: LabPaths): Promise<void> => {
  const env = buildLabEnv(paths);
  const id = "lab-feature-matrix-codex";
  const createdAt = "2026-05-29T09:01:00.000Z";
  const sessionPath = path.join(
    env.CODEX_HOME,
    "sessions",
    "2026",
    "05",
    "29",
    "rollout-2026-05-29T09-01-00-lab-feature-matrix-codex.jsonl",
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    renderJsonl([
      {
        timestamp: createdAt,
        type: "session_meta",
        payload: {
          id,
          timestamp: createdAt,
          cwd: paths.projectDir,
        },
      },
      {
        timestamp: "2026-05-29T09:01:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Feature fixture: inspect ${FEATURE_RELATIVE_PATH} and preserve tool context.`,
            },
          ],
        },
      },
      {
        timestamp: "2026-05-29T09:01:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: `${FEATURE_THINKING}\n${FEATURE_ASSISTANT_TEXT}\n${FEATURE_TOOL_RESULT}`,
            },
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: FEATURE_RELATIVE_PATH },
            },
          ],
        },
      },
    ]),
    "utf8",
  );
  await appendFile(
    path.join(env.CODEX_HOME, "session_index.jsonl"),
    `${JSON.stringify({ id, thread_name: "Lab Feature Matrix Codex" })}\n`,
    "utf8",
  );
};

const seedClaudeSource = async (paths: LabPaths): Promise<void> => {
  const env = buildLabEnv(paths);
  const sessionId = "00000000-0000-4000-8000-00000000c1a0";
  const projectDir = path.join(
    env.CLAUDE_CONFIG_DIR,
    "projects",
    encodeClaudeProjectPath(paths.projectDir),
  );
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    path.join(projectDir, `${sessionId}.jsonl`),
    renderJsonl([
      {
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: {
          role: "user",
          content: "Claude source: keep the lab context portable.",
        },
        uuid: "00000000-0000-4000-8000-00000000c1a1",
        timestamp: "2026-05-29T09:05:01.000Z",
        userType: "external",
        entrypoint: "cli",
        cwd: paths.projectDir,
        sessionId,
        version: "2.1.156",
        gitBranch: "main",
      },
      {
        parentUuid: "00000000-0000-4000-8000-00000000c1a1",
        isSidechain: false,
        type: "assistant",
        message: {
          id: "msg_lab_claude",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            {
              type: "text",
              text: "Claude source is ready for native sync targets.",
            },
          ],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
        requestId: null,
        uuid: "00000000-0000-4000-8000-00000000c1a2",
        timestamp: "2026-05-29T09:05:02.000Z",
        userType: "external",
        entrypoint: "cli",
        cwd: paths.projectDir,
        sessionId,
        version: "2.1.156",
        gitBranch: "main",
      },
    ]),
    "utf8",
  );
  await seedClaudeFeatureSource(paths, projectDir);
};

const seedClaudeFeatureSource = async (
  paths: LabPaths,
  projectDir: string,
): Promise<void> => {
  const sessionId = "00000000-0000-4000-8000-00000000f1a0";
  await writeFile(
    path.join(projectDir, `${sessionId}.jsonl`),
    renderJsonl([
      {
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: {
          role: "user",
          content: `Feature fixture: inspect ${FEATURE_RELATIVE_PATH} and preserve clickable path text.`,
        },
        uuid: "00000000-0000-4000-8000-00000000f1a1",
        timestamp: "2026-05-29T09:06:01.000Z",
        userType: "external",
        entrypoint: "cli",
        cwd: paths.projectDir,
        sessionId,
        version: "2.1.156",
        gitBranch: "main",
      },
      {
        parentUuid: "00000000-0000-4000-8000-00000000f1a1",
        isSidechain: false,
        type: "assistant",
        message: {
          id: "msg_lab_feature_claude",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            {
              type: "text",
              text: `${FEATURE_THINKING}\n${FEATURE_ASSISTANT_TEXT}\n${FEATURE_TOOL_RESULT}`,
            },
            {
              type: "tool_use",
              id: "toolu_lab_feature",
              name: "Read",
              input: { file_path: FEATURE_RELATIVE_PATH },
            },
          ],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
        requestId: null,
        uuid: "00000000-0000-4000-8000-00000000f1a2",
        timestamp: "2026-05-29T09:06:02.000Z",
        userType: "external",
        entrypoint: "cli",
        cwd: paths.projectDir,
        sessionId,
        version: "2.1.156",
        gitBranch: "main",
      },
    ]),
    "utf8",
  );
};

const seedCursorSource = async (paths: LabPaths): Promise<void> => {
  const env = buildLabEnv(paths);
  const workspaceDir = path.join(env.POKO_CURSOR_STORAGE_ROOT, "lab-workspace");
  const workspaceDbPath = path.join(workspaceDir, "state.vscdb");
  const composerId = "00000000-0000-4000-8000-00000000c500";
  const userBubbleId = "00000000-0000-4000-8000-00000000c501";
  const assistantBubbleId = "00000000-0000-4000-8000-00000000c502";
  const createdAt = Date.parse("2026-05-29T09:10:00.000Z");
  const updatedAt = Date.parse("2026-05-29T09:10:02.000Z");
  const workspaceIdentifier = cursorLabWorkspaceIdentifier(
    "lab-workspace",
    paths.projectDir,
  );
  const head = {
    type: "head",
    composerId,
    name: "Lab Cursor source",
    createdAt,
    lastUpdatedAt: updatedAt,
    conversationCheckpointLastUpdatedAt: updatedAt,
    unifiedMode: "agent",
    forceMode: "edit",
    hasUnreadMessages: false,
    contextUsagePercent: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    filesChangedCount: 0,
    hasBlockingPendingActions: false,
    hasPendingPlan: false,
    isArchived: false,
    isDraft: false,
    isWorktree: false,
    worktreeStartedReadOnly: false,
    isSpec: false,
    isProject: false,
    isBestOfNSubcomposer: false,
    numSubComposers: 0,
    referencedPlans: [],
    trackedGitRepos: [],
    workspaceIdentifier,
    agentLocation: {
      type: "local",
      environment: workspaceIdentifier,
      status: "active",
    },
    agentLocationHistory: [
      {
        id: "00000000-0000-4000-8000-00000000c5ff",
        timestamp: createdAt,
        destination: { type: "local" },
        location: {
          type: "local",
          environment: workspaceIdentifier,
          status: "active",
        },
        reason: "created",
      },
    ],
  };
  const headers = [
    { bubbleId: userBubbleId, type: 1 },
    {
      bubbleId: assistantBubbleId,
      type: 2,
      grouping: {
        isRenderable: true,
        hasText: true,
        isShortPlainText: true,
        isKeptFinalAiVisibleOutsideWorkedForGroup: true,
      },
    },
  ];

  await mkdir(workspaceDir, { recursive: true });
  await writeFile(
    path.join(workspaceDir, "workspace.json"),
    JSON.stringify({ folder: pathToFileURL(paths.projectDir).href }),
    "utf8",
  );

  const workspaceDatabase = new Database(workspaceDbPath);
  const globalDatabase = new Database(env.POKO_CURSOR_GLOBAL_STATE_DB);

  try {
    workspaceDatabase.run(
      "create table if not exists ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
    );
    workspaceDatabase
      .query("insert or replace into ItemTable (key, value) values (?, ?)")
      .run(
        "composer.composerData",
        JSON.stringify({
          allComposers: [head],
          selectedComposerIds: [composerId],
          lastFocusedComposerIds: [composerId],
          hasMigratedComposerData: true,
          hasMigratedMultipleComposers: true,
        }),
      );
    globalDatabase
      .query("insert or replace into ItemTable (key, value) values (?, ?)")
      .run(
        "composer.composerHeaders",
        JSON.stringify({ allComposers: [head] }),
      );
    globalDatabase
      .query("insert or replace into cursorDiskKV (key, value) values (?, ?)")
      .run(
        `composerData:${composerId}`,
        JSON.stringify({
          _v: 16,
          composerId,
          name: "Lab Cursor source",
          createdAt,
          lastUpdatedAt: updatedAt,
          richText: emptyCursorLabRichText(),
          hasLoaded: true,
          text: "",
          fullConversationHeadersOnly: headers,
          conversationMap: {},
          status: "completed",
          context: emptyCursorLabContext(),
          gitGraphFileSuggestions: [],
          generatingBubbleIds: [],
          isReadingLongFile: false,
          codeBlockData: {},
          originalFileStates: {},
          newlyCreatedFiles: [],
          newlyCreatedFolders: [],
          hasChangedContext: false,
          activeTabsShouldBeReactive: true,
          capabilities: [],
          isFileListExpanded: false,
          browserChipManuallyDisabled: false,
          browserChipManuallyEnabled: false,
          usageData: {},
          modelConfig: cursorLabModelConfig(),
          unifiedMode: "agent",
          forceMode: "edit",
          isAgentic: true,
          contextUsagePercent: 0,
          contextTokensUsed: 0,
          contextTokenLimit: 0,
          allAttachedFileCodeChunksUris: [],
          subComposerIds: [],
          capabilityContexts: [],
          todos: [],
          isQueueExpanded: false,
          hasUnreadMessages: false,
          gitHubPromptDismissed: true,
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
          addedFiles: [],
          removedFiles: [],
          isArchived: false,
          isDraft: false,
          isCreatingWorktree: false,
          isApplyingWorktree: false,
          isUndoingWorktree: false,
          applied: false,
          pendingCreateWorktree: false,
          isBestOfNSubcomposer: false,
          isBestOfNParent: false,
          isSpec: false,
          isSpecSubagentDone: false,
          stopHookLoopCount: 0,
          isNAL: false,
          planModeSuggestionUsed: false,
          latestChatGenerationUUID: "",
          subtitle: "2 imported message(s) from cursor",
          filesChangedCount: 0,
          trackedGitRepos: [],
          workspaceIdentifier,
        }),
      );
    globalDatabase
      .query("insert or replace into cursorDiskKV (key, value) values (?, ?)")
      .run(
        `bubbleId:${composerId}:${userBubbleId}`,
        JSON.stringify(
          cursorLabBubble({
            type: 1,
            bubbleId: userBubbleId,
            text: "Cursor source: verify GUI import behavior.",
            createdAt: "2026-05-29T09:10:01.000Z",
            projectDir: paths.projectDir,
          }),
        ),
      );
    globalDatabase
      .query("insert or replace into cursorDiskKV (key, value) values (?, ?)")
      .run(
        `bubbleId:${composerId}:${assistantBubbleId}`,
        JSON.stringify(
          cursorLabBubble({
            type: 2,
            bubbleId: assistantBubbleId,
            text: "Cursor source conversation is ready for cross-agent sync.",
            createdAt: "2026-05-29T09:10:02.000Z",
            projectDir: paths.projectDir,
          }),
        ),
      );
  } finally {
    workspaceDatabase.close();
    globalDatabase.close();
  }
};

const cursorLabWorkspaceIdentifier = (
  workspaceId: string,
  projectDir: string,
): Record<string, unknown> => {
  const fileUri = pathToFileURL(projectDir).href;

  return {
    id: workspaceId,
    uri: {
      $mid: 1,
      fsPath: projectDir,
      external: fileUri,
      path: projectDir,
      scheme: "file",
    },
  };
};

const cursorLabBubble = (input: {
  type: 1 | 2;
  bubbleId: string;
  text: string;
  createdAt: string;
  projectDir: string;
}): Record<string, unknown> => {
  const common = {
    _v: 3,
    type: input.type,
    bubbleId: input.bubbleId,
    text: input.text,
    createdAt: input.createdAt,
    isAgentic: true,
    unifiedMode: 2,
    approximateLintErrors: [],
    lints: [],
    codebaseContextChunks: [],
    commits: [],
    pullRequests: [],
    attachedCodeChunks: [],
    assistantSuggestedDiffs: [],
    gitDiffs: [],
    interpreterResults: [],
    images: [],
    attachedFolders: [],
    attachedFoldersNew: [],
    userResponsesToSuggestedCodeBlocks: [],
    suggestedCodeBlocks: [],
    toolResults: [],
    capabilities: [],
    capabilityStatuses: {},
    contextPieces: [],
    allThinkingBlocks: [],
    supportedTools: [],
    tokenCount: { inputTokens: 0, outputTokens: 0 },
    workspaceUris: [pathToFileURL(input.projectDir).href],
    modelInfo: { modelName: "composer-2.5" },
    context: emptyCursorLabContext(),
  };

  if (input.type === 1) {
    return {
      ...common,
      richText: cursorLabRichText(input.text),
      editToolSupportsSearchAndReplace: false,
    };
  }

  return {
    ...common,
    codeBlocks: [],
    timingInfo: {
      clientRpcSendTime: Date.parse(input.createdAt),
      clientSettleTime: Date.parse(input.createdAt),
      clientEndTime: Date.parse(input.createdAt),
    },
  };
};

const cursorLabModelConfig = (): Record<string, unknown> => ({
  modelName: "composer-2.5",
  maxMode: false,
  selectedModels: [
    {
      modelId: "composer-2.5",
      parameters: [{ id: "fast", value: "true" }],
    },
  ],
});

const cursorLabRichText = (text: string): string =>
  JSON.stringify({
    root: {
      children: text.split("\n").map((line) => ({
        children: line
          ? [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: line,
                type: "text",
                version: 1,
              },
            ]
          : [],
        direction: line ? "ltr" : null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      })),
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });

const emptyCursorLabRichText = (): string => cursorLabRichText("");

const emptyCursorLabContext = (): Record<string, unknown> => ({
  composers: [],
  selectedCommits: [],
  selectedPullRequests: [],
  selectedImages: [],
  selectedDocuments: [],
  selectedVideos: [],
  folderSelections: [],
  fileSelections: [],
  selections: [],
  terminalSelections: [],
  selectedDocs: [],
  externalLinks: [],
  cursorRules: [],
  cursorCommands: [],
  gitPRDiffSelections: [],
  subagentSelections: [],
  browserSelections: [],
  extraContext: [],
  mentions: {
    composers: {},
    selectedCommits: {},
    selectedPullRequests: {},
    gitDiff: [],
    gitDiffFromBranchToMain: [],
    selectedImages: {},
    folderSelections: {},
    fileSelections: {},
    terminalFiles: {},
    selections: {},
    terminalSelections: {},
    selectedDocs: {},
    externalLinks: {},
    diffHistory: [],
    cursorRules: {},
    cursorCommands: {},
    uiElementSelections: [],
    consoleLogs: [],
    ideEditorsState: [],
    gitPRDiffSelections: {},
    subagentSelections: {},
    browserSelections: {},
  },
});

const seedPiSource = async (paths: LabPaths): Promise<void> => {
  const env = buildLabEnv(paths);
  const sessionPath = path.join(
    env.PI_CODING_AGENT_DIR,
    "sessions",
    encodePiProjectPath(paths.projectDir),
    "2026-05-29T09-15-00-000Z_lab-pi-session.jsonl",
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    renderJsonl([
      {
        type: "session",
        version: 3,
        id: "lab-pi-session",
        timestamp: "2026-05-29T09:15:00.000Z",
        cwd: paths.projectDir,
      },
      {
        type: "session_info",
        id: "lab-pi-title",
        parentId: null,
        timestamp: "2026-05-29T09:15:00.000Z",
        name: "Lab Pi source",
      },
      {
        type: "message",
        id: "lab-pi-user",
        parentId: "lab-pi-title",
        timestamp: "2026-05-29T09:15:01.000Z",
        message: {
          role: "user",
          content: "Pi source: sync my context into the rest of the lab.",
          timestamp: Date.parse("2026-05-29T09:15:01.000Z"),
        },
      },
      {
        type: "message",
        id: "lab-pi-assistant",
        parentId: "lab-pi-user",
        timestamp: "2026-05-29T09:15:02.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Pi source history is ready for import testing.",
            },
          ],
          api: "lab",
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          usage: {},
          stopReason: "stop",
          timestamp: Date.parse("2026-05-29T09:15:02.000Z"),
        },
      },
    ]),
    "utf8",
  );
};

const seedHermesSource = async (paths: LabPaths): Promise<void> => {
  const env = buildLabEnv(paths);
  const dbPath = path.join(env.HERMES_HOME, "state.db");
  const database = new Database(dbPath);

  try {
    createHermesStateSchema(database);
    database
      .query(
        `insert or replace into sessions (
          id, source, model_config, system_prompt, started_at, ended_at, title, message_count
        ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "lab-hermes-session",
        "cli",
        null,
        `Current working directory: ${paths.projectDir}`,
        Date.parse("2026-05-29T09:20:00.000Z") / 1000,
        Date.parse("2026-05-29T09:20:02.000Z") / 1000,
        "Lab Hermes source",
        2,
      );
    database
      .query("delete from messages where session_id = ?")
      .run("lab-hermes-session");
    database
      .query(
        "insert into messages (session_id, role, content, timestamp) values (?, ?, ?, ?)",
      )
      .run(
        "lab-hermes-session",
        "user",
        "Hermes source: make parity visible.",
        Date.parse("2026-05-29T09:20:01.000Z") / 1000,
      );
    database
      .query(
        "insert into messages (session_id, role, content, timestamp) values (?, ?, ?, ?)",
      )
      .run(
        "lab-hermes-session",
        "assistant",
        "Hermes source is present in the lab.",
        Date.parse("2026-05-29T09:20:02.000Z") / 1000,
      );
  } finally {
    database.close();
  }
};

const seedOpenClawSource = async (paths: LabPaths): Promise<void> => {
  const env = buildLabEnv(paths);
  const sessionDir = path.join(
    env.OPENCLAW_STATE_DIR,
    "agents",
    "main",
    "sessions",
  );
  const sessionPath = path.join(
    sessionDir,
    "2026-05-29T09-25-00-000Z_lab-openclaw-session.jsonl",
  );
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    sessionPath,
    renderJsonl([
      {
        type: "session",
        version: 3,
        id: "lab-openclaw-session",
        timestamp: "2026-05-29T09:25:00.000Z",
        cwd: paths.projectDir,
      },
      {
        type: "session_info",
        id: "lab-openclaw-title",
        parentId: null,
        timestamp: "2026-05-29T09:25:00.000Z",
        name: "Lab OpenClaw source",
      },
      {
        type: "message",
        id: "lab-openclaw-user",
        parentId: "lab-openclaw-title",
        timestamp: "2026-05-29T09:25:01.000Z",
        message: {
          role: "user",
          content: "OpenClaw source: prove JSONL session portability.",
        },
      },
      {
        type: "message",
        id: "lab-openclaw-assistant",
        parentId: "lab-openclaw-user",
        timestamp: "2026-05-29T09:25:02.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "OpenClaw source is ready for target verification.",
            },
          ],
        },
      },
    ]),
    "utf8",
  );
};

const runScenario = async (options: {
  repoRoot: string;
  root?: string;
  profile?: string;
  run?: string;
  name: ScenarioName;
  write?: boolean;
  noReset?: boolean;
  yes?: boolean;
}): Promise<ScenarioResult> => {
  if (options.name === "reset-modes") {
    return runResetModesScenario(options);
  }

  const scenario = SCENARIOS[options.name];
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
    agents: scenario.sources,
  });

  const before = await collectReportSnapshot(paths);
  const commands: ScenarioResult["commands"] = [];
  const startedAt = new Date().toISOString();

  for (const target of scenario.targets) {
    const args = defaultPokoCommand(
      options.repoRoot,
      "sync",
      "--agent",
      target,
      ...(options.write ? [] : ["--dry-run"]),
    );
    const result = await runLabCommand({
      repoRoot: options.repoRoot,
      root: options.root,
      profile: options.profile,
      run: options.run,
      capture: true,
      args,
    });
    const logFile = `scenario-${options.name}-${target}${options.write ? "" : "-dry-run"}.txt`;
    await mkdir(paths.reportDir, { recursive: true });
    await writeFile(
      path.join(paths.reportDir, logFile),
      formatCommandLog(args, result),
      "utf8",
    );
    commands.push({
      label: `sync ${target}`,
      args,
      exitCode: result.exitCode,
      logFile,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Scenario ${options.name} failed while syncing ${target}. See ${path.join(paths.reportDir, logFile)}.`,
      );
    }
  }

  const after = await collectReportSnapshot(paths);
  const scenarioResult: ScenarioResult = {
    name: options.name,
    mode: options.write ? "write" : "dry-run",
    startedAt,
    finishedAt: new Date().toISOString(),
    sources: scenario.sources,
    targets: scenario.targets,
    commands,
    before,
    after,
    notes: [scenario.description],
  };

  await writeScenarioResult(paths, scenarioResult);
  await writeReport({
    root: options.root,
    profile: options.profile,
    run: options.run,
  });
  console.log(
    `${pc.green("poko-lab")} scenario ${options.name} finished in ${scenarioResult.mode} mode.`,
  );

  return scenarioResult;
};

const runResetModesScenario = async (options: {
  repoRoot: string;
  root?: string;
  profile?: string;
  run?: string;
  yes?: boolean;
}): Promise<ScenarioResult> => {
  const profile = `${options.profile ?? DEFAULT_PROFILE}-reset-demo`;
  const run = options.run ?? DEFAULT_RUN;
  const paths = await resetLab({
    repoRoot: options.repoRoot,
    root: options.root,
    profile,
    run,
    includeAuth: true,
    yes: true,
  });
  const sentinel = path.join(paths.runHome, ".config", "poko-lab", "login.txt");
  await mkdir(path.dirname(sentinel), { recursive: true });
  await writeFile(sentinel, "signed-in", "utf8");
  await snapshotAuth({ root: options.root, profile, run, force: true });
  await rm(sentinel, { force: true });
  const before = await collectReportSnapshot(paths);
  await resetLab({
    repoRoot: options.repoRoot,
    root: options.root,
    profile,
    run,
  });
  const preserved = await readFile(sentinel, "utf8").catch(() => "");
  await resetLab({
    repoRoot: options.repoRoot,
    root: options.root,
    profile,
    run,
    includeAuth: true,
    yes: true,
  });
  const nuked = !(await pathExists(sentinel));
  const after = await collectReportSnapshot(paths);
  const result: ScenarioResult = {
    name: "reset-modes",
    mode: "write",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    sources: [],
    targets: [],
    commands: [],
    before,
    after,
    notes: [
      `normal reset preserved auth sentinel: ${preserved === "signed-in"}`,
      `reset --include-auth --yes cleared auth sentinel: ${nuked}`,
      `demo profile: ${profile}`,
    ],
  };

  await writeScenarioResult(paths, result);
  await writeReport({ root: options.root, profile, run });
  console.log(
    `${pc.green("poko-lab")} reset-modes scenario finished in demo profile ${profile}.`,
  );
  return result;
};

const runAcceptance = async (options: {
  repoRoot: string;
  root?: string;
  profile?: string;
  run?: string;
  agents?: AcceptanceAgent[];
  prepare?: boolean;
}): Promise<AcceptanceReport> => {
  const agents = options.agents ?? [...ACCEPTANCE_AGENTS];
  const paths = options.prepare
    ? await prepareAcceptanceFixture({ ...options, agents })
    : createLabPaths(options);
  const snapshot = await collectReportSnapshot(paths);
  const expectedTitles = snapshot.capturedSessions.map(
    (session) => session.title,
  );
  const results: AcceptanceResult[] = [];

  for (const agent of agents) {
    results.push(
      await acceptAgent({
        paths,
        agent,
        expectedTitles,
      }),
    );
  }

  const report: AcceptanceReport = {
    acceptedAt: new Date().toISOString(),
    prepared: Boolean(options.prepare),
    results,
  };

  await mkdir(paths.reportDir, { recursive: true });
  await writeFile(
    path.join(paths.reportDir, "acceptance-results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await writeReport({
    root: options.root,
    profile: options.profile,
    run: options.run,
  });

  const passed = results.filter((result) => result.status === "pass").length;
  const manual = results.filter((result) => result.status === "manual").length;
  const skipped = results.filter((result) => result.status === "skip").length;
  const failed = results.filter((result) => result.status === "fail").length;
  console.log(
    `${pc.green("poko-lab")} acceptance complete: ${passed} pass, ${manual} manual, ${skipped} skip, ${failed} fail.`,
  );

  if (failed > 0) {
    throw new Error(
      "One or more acceptance checks failed. See acceptance-results.json.",
    );
  }

  return report;
};

const prepareAcceptanceFixture = async (options: {
  repoRoot: string;
  root?: string;
  profile?: string;
  run?: string;
  agents?: AcceptanceAgent[];
}): Promise<LabPaths> => {
  const paths = await resetLab({
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

  const targets = options.agents
    ? NATIVE_TARGET_AGENTS.filter((target) =>
        options.agents?.includes(target as AcceptanceAgent),
      )
    : NATIVE_TARGET_AGENTS;

  for (const target of targets) {
    await runLabCommand({
      repoRoot: options.repoRoot,
      root: options.root,
      profile: options.profile,
      run: options.run,
      capture: true,
      args: defaultPokoCommand(options.repoRoot, "sync", "--agent", target),
      env:
        target === "opencode" ? { POKO_OPENCODE_BIN: "opencode" } : undefined,
    });
  }

  return paths;
};

const acceptAgent = async (options: {
  paths: LabPaths;
  agent: AcceptanceAgent;
  expectedTitles: string[];
}): Promise<AcceptanceResult> => {
  switch (options.agent) {
    case "opencode":
      return acceptOpenCode(options.paths, options.expectedTitles);
    case "codex":
      return manualTuiAcceptance({
        paths: options.paths,
        agent: "codex",
        binary: "codex",
        command: "codex resume --all --no-alt-screen",
        expectedTitles: options.expectedTitles.filter(
          (title) => !title.includes("Codex source"),
        ),
        notes: [
          "Codex exposes imported sessions through the interactive resume picker, but this CLI does not currently expose a stable noninteractive list command.",
          "Run the command in the lab terminal and confirm the expected titles are visible.",
        ],
      });
    case "claude":
      return manualTuiAcceptance({
        paths: options.paths,
        agent: "claude",
        binary: "claude",
        command: "claude --resume",
        expectedTitles: options.expectedTitles.filter(
          (title) => !title.startsWith("Claude source"),
        ),
        notes: [
          "Claude Code exposes imports through the interactive resume picker.",
          "First-run theme/auth prompts may appear in a new lab profile; snapshot the signed-in baseline after completing them.",
        ],
      });
    case "cursor":
      return manualGuiAcceptance({
        paths: options.paths,
        agent: "cursor",
        binary: "cursor",
        command: `cursor --password-store=basic ${shellQuote(options.paths.projectDir)}`,
        expectedTitles: options.expectedTitles.filter(
          (title) => !title.includes("Cursor source"),
        ),
        notes: [
          "Cursor chat display is GUI-only for this storage path.",
          "Use the noVNC GUI lane or local Cursor with the printed lab env and confirm the imported composers appear.",
        ],
      });
    case "t3code":
      return manualGuiAcceptance({
        paths: options.paths,
        agent: "t3code",
        binary: "t3",
        command:
          "Launch T3 Code inside the GUI lab and open the Poko workspace.",
        expectedTitles: options.expectedTitles,
        notes: [
          "T3 Code is GUI-first; the lab writes its SQLite event log, then visual confirmation belongs in the GUI lane.",
        ],
      });
    case "pi":
    case "hermes":
    case "openclaw":
      return manualCliAcceptance({
        paths: options.paths,
        agent: options.agent,
        binary: options.agent === "openclaw" ? "openclaw" : options.agent,
        expectedTitles: options.expectedTitles.filter(
          (title) => !title.toLowerCase().includes(options.agent),
        ),
      });
  }
};

const acceptOpenCode = async (
  paths: LabPaths,
  expectedTitles: string[],
): Promise<AcceptanceResult> => {
  const binary = await commandPath("opencode");
  const expected = expectedTitles;
  const command = "opencode session list";

  if (!binary) {
    return {
      agent: "opencode",
      surface: "cli",
      status: "skip",
      command,
      expectedTitles: expected,
      notes: ["opencode binary was not found on PATH."],
    };
  }

  const result = await runExternalInLab(paths, ["opencode", "session", "list"]);
  const logFile = "acceptance-opencode-session-list.txt";
  await mkdir(paths.reportDir, { recursive: true });
  await writeFile(
    path.join(paths.reportDir, logFile),
    formatCommandLog(["opencode", "session", "list"], result),
    "utf8",
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const missingTitles = expected.filter((title) => !output.includes(title));

  return {
    agent: "opencode",
    surface: "cli",
    status:
      result.exitCode === 0 && missingTitles.length === 0 ? "pass" : "fail",
    command,
    logFile,
    expectedTitles: expected,
    observed: output.trim(),
    notes:
      missingTitles.length === 0
        ? ["Real OpenCode CLI listed every imported lab session."]
        : [`Missing title(s): ${missingTitles.join(", ")}`],
  };
};

const manualTuiAcceptance = async (options: {
  paths: LabPaths;
  agent: AcceptanceAgent;
  binary: string;
  command: string;
  expectedTitles: string[];
  notes: string[];
}): Promise<AcceptanceResult> => ({
  agent: options.agent,
  surface: "tui",
  status: (await commandPath(options.binary)) ? "manual" : "skip",
  command: options.command,
  expectedTitles: options.expectedTitles,
  notes: (await commandPath(options.binary))
    ? [
        ...options.notes,
        `Run from the repo: bun lab/poko-lab.ts env, then ${options.command}`,
      ]
    : [`${options.binary} binary was not found on PATH.`],
});

const manualGuiAcceptance = async (options: {
  paths: LabPaths;
  agent: AcceptanceAgent;
  binary: string;
  command: string;
  expectedTitles: string[];
  notes: string[];
}): Promise<AcceptanceResult> => ({
  agent: options.agent,
  surface: "gui",
  status: (await commandPath(options.binary)) ? "manual" : "skip",
  command: options.command,
  expectedTitles: options.expectedTitles,
  notes: [
    ...options.notes,
    "Start GUI lane: docker compose -f lab/docker-compose.gui.yml up",
    "Open http://localhost:3001 and run /workspace/poko/lab/gui/bootstrap.sh inside the desktop.",
  ],
});

const manualCliAcceptance = async (options: {
  paths: LabPaths;
  agent: AcceptanceAgent;
  binary: string;
  expectedTitles: string[];
}): Promise<AcceptanceResult> => ({
  agent: options.agent,
  surface: "cli",
  status: (await commandPath(options.binary)) ? "manual" : "skip",
  expectedTitles: options.expectedTitles,
  notes: (await commandPath(options.binary))
    ? [
        "This agent does not have a Poko-known noninteractive session list yet.",
        "Use its CLI in the lab environment and confirm the expected titles/messages render.",
      ]
    : [`${options.binary} binary was not found on PATH.`],
});

export const writeScenarioResult = async (
  paths: LabPaths,
  result: ScenarioResult,
): Promise<void> => {
  await mkdir(paths.reportDir, { recursive: true });
  await writeFile(
    path.join(paths.reportDir, "scenario-results.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
};

const smoke = async (options: {
  repoRoot: string;
  root?: string;
  profile?: string;
  run?: string;
  write?: boolean;
  noReset?: boolean;
}): Promise<void> => {
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
  const reportPaths = await mkdir(paths.reportDir, { recursive: true }).then(
    () => paths,
  );
  const doctorResult = await runLabCommand({
    repoRoot: options.repoRoot,
    root: options.root,
    profile: options.profile,
    run: options.run,
    capture: true,
    args: defaultPokoCommand(options.repoRoot, "doctor"),
  });
  const syncArgs = defaultPokoCommand(
    options.repoRoot,
    "sync",
    "--all",
    ...(options.write ? [] : ["--dry-run"]),
  );
  const syncResult = await runLabCommand({
    repoRoot: options.repoRoot,
    root: options.root,
    profile: options.profile,
    run: options.run,
    capture: true,
    args: syncArgs,
  });

  await writeFile(
    path.join(reportPaths.reportDir, "poko-doctor.txt"),
    formatCommandLog(
      defaultPokoCommand(options.repoRoot, "doctor"),
      doctorResult,
    ),
    "utf8",
  );
  await writeFile(
    path.join(
      reportPaths.reportDir,
      options.write ? "poko-sync.txt" : "poko-sync-dry-run.txt",
    ),
    formatCommandLog(syncArgs, syncResult),
    "utf8",
  );

  const after = await collectReportSnapshot(paths);
  await writeScenarioResult(paths, {
    name: "smoke",
    mode: options.write ? "write" : "dry-run",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    sources: SEED_AGENTS,
    targets: ["all enabled adapters"],
    commands: [
      {
        label: "doctor",
        args: defaultPokoCommand(options.repoRoot, "doctor"),
        exitCode: doctorResult.exitCode,
        logFile: "poko-doctor.txt",
      },
      {
        label: "sync --all",
        args: syncArgs,
        exitCode: syncResult.exitCode,
        logFile: options.write ? "poko-sync.txt" : "poko-sync-dry-run.txt",
      },
    ],
    before,
    after,
    notes: [
      "Smoke seeds every supported source importer, then runs poko sync --all.",
    ],
  });

  await writeReport({
    root: options.root,
    profile: options.profile,
    run: options.run,
  });

  if (doctorResult.exitCode !== 0 || syncResult.exitCode !== 0) {
    throw new Error(`Smoke failed. See ${reportPaths.reportDir} for logs.`);
  }
};

const runInLab = async (options: RunOptions): Promise<number> => {
  const result = await runLabCommand(options);
  return result.exitCode;
};

export const runLabCommand = async (
  options: RunOptions,
): Promise<CommandResult> => {
  const paths = createLabPaths(options);

  if (!(await pathExists(paths.projectDir))) {
    await resetLab({
      repoRoot: options.repoRoot,
      root: options.root,
      profile: options.profile,
      run: options.run,
    });
  }

  const env = {
    ...process.env,
    ...buildLabEnv(paths),
    ...options.env,
  };
  const args = stripLeadingSeparator(options.args);
  const child = Bun.spawn(args, {
    cwd: paths.projectDir,
    env,
    stdout: options.capture ? "pipe" : "inherit",
    stderr: options.capture ? "pipe" : "inherit",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    options.capture ? new Response(child.stdout).text() : Promise.resolve(""),
    options.capture ? new Response(child.stderr).text() : Promise.resolve(""),
  ]);

  return { exitCode, stdout, stderr };
};

const runExternalInLab = async (
  paths: LabPaths,
  args: string[],
): Promise<CommandResult> => {
  const child = Bun.spawn(args, {
    cwd: paths.projectDir,
    env: {
      ...process.env,
      ...buildLabEnv(paths),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { exitCode, stdout, stderr };
};

export const writeReport = async (options: ReportOptions): Promise<string> => {
  const paths = createLabPaths(options);
  await mkdir(paths.reportDir, { recursive: true });

  const stores = await summarizeStores(paths);
  const logs = await summarizeLogs(paths.reportDir);
  const snapshot = await collectReportSnapshot(paths);
  const scenario = await readScenarioResult(paths.reportDir);
  const acceptance = await readAcceptanceReport(paths.reportDir);
  const gate = await readGateResult(paths.reportDir);
  const reportPath = path.join(paths.reportDir, "index.html");
  const html = renderReport(
    paths,
    stores,
    logs,
    snapshot,
    scenario,
    acceptance,
    gate,
  );

  await writeFile(reportPath, html, "utf8");
  console.log(`${pc.green("poko-lab")} wrote report: ${reportPath}`);

  return reportPath;
};

const summarizeStores = async (paths: LabPaths): Promise<StoreSummary[]> => {
  const env = buildLabEnv(paths);
  const codexSessions = path.join(env.CODEX_HOME, "sessions");
  const claudeProjects = path.join(env.CLAUDE_CONFIG_DIR, "projects");
  const cursorWorkspace = env.POKO_CURSOR_STORAGE_ROOT;
  const cursorGlobalDb = env.POKO_CURSOR_GLOBAL_STATE_DB;
  const t3Db = env.POKO_T3CODE_DB_PATH;
  const opencodeDb = env.POKO_LAB_OPENCODE_DB;
  const opencodeNativePayloads = path.join(
    paths.projectDir,
    ".poko",
    "native",
    "opencode",
  );
  const realOpenCodeDb = path.join(
    env.XDG_DATA_HOME,
    "opencode",
    "opencode.db",
  );
  const piSessions = path.join(env.PI_CODING_AGENT_DIR, "sessions");
  const hermesDb = path.join(env.HERMES_HOME, "state.db");
  const openClawSessions = path.join(
    env.OPENCLAW_STATE_DIR,
    "agents",
    "main",
    "sessions",
  );

  return Promise.all([
    summarizeDirectory(
      "Codex sessions",
      codexSessions,
      "CODEX_HOME rollout JSONL files.",
    ),
    summarizeDirectory(
      "Claude projects",
      claudeProjects,
      "Claude Code project JSONL files.",
    ),
    summarizeFile(
      "Cursor global DB",
      cursorGlobalDb,
      "Cursor global state database.",
      ["ItemTable", "cursorDiskKV"],
    ),
    summarizeDirectory(
      "Cursor workspace storage",
      cursorWorkspace,
      "Cursor per-workspace state databases.",
    ),
    summarizeFile("T3 Code DB", t3Db, "T3 Code desktop state.sqlite.", [
      "orchestration_events",
      "projection_projects",
      "projection_threads",
    ]),
    summarizeDirectory(
      "OpenCode payloads",
      opencodeNativePayloads,
      "Poko-generated OpenCode import payloads.",
    ),
    summarizeFile("OpenCode DB", opencodeDb, "Fake lab OpenCode database.", [
      "session",
      "message",
      "part",
    ]),
    summarizeFile(
      "OpenCode real DB",
      realOpenCodeDb,
      "Real OpenCode CLI database used by acceptance checks.",
      ["session", "message", "part"],
    ),
    summarizeDirectory(
      "Pi sessions",
      piSessions,
      "Pi project session JSONL files.",
    ),
    summarizeFile("Hermes DB", hermesDb, "Hermes state database.", [
      "sessions",
      "messages",
    ]),
    summarizeDirectory(
      "OpenClaw sessions",
      openClawSessions,
      "OpenClaw agent session JSONL files and sessions.json.",
    ),
  ]);
};

const summarizeDirectory = async (
  label: string,
  directory: string,
  description: string,
): Promise<StoreSummary> => {
  if (!(await pathExists(directory))) {
    return {
      label,
      kind: "directory",
      path: directory,
      description,
      exists: false,
      fileCount: 0,
      sampleFiles: [],
    };
  }

  const files = await walkFiles(directory);

  return {
    label,
    kind: "directory",
    path: directory,
    description,
    exists: true,
    fileCount: files.length,
    sampleFiles: files
      .slice(0, 8)
      .map((filePath) => path.relative(directory, filePath)),
  };
};

const summarizeFile = async (
  label: string,
  filePath: string,
  description: string,
  sqliteTables: string[],
): Promise<StoreSummary> => {
  if (!(await pathExists(filePath))) {
    return {
      label,
      kind: "file",
      path: filePath,
      description,
      exists: false,
    };
  }

  return {
    label,
    kind: "file",
    path: filePath,
    description,
    exists: true,
    sqliteTables: summarizeSqliteTables(filePath, sqliteTables),
  };
};

const summarizeSqliteTables = (
  filePath: string,
  tables: string[],
): Array<{ name: string; rows: number | string }> => {
  const database = new Database(filePath, { readonly: true });

  try {
    return tables.map((name) => {
      try {
        const row = database
          .query(`select count(*) as count from ${quoteSqlIdentifier(name)}`)
          .get() as { count: number } | undefined;
        return { name, rows: row?.count ?? 0 };
      } catch {
        return { name, rows: "missing" };
      }
    });
  } finally {
    database.close();
  }
};

const summarizeLogs = async (
  reportDir: string,
): Promise<Array<{ name: string; content: string }>> => {
  const entries = await readdir(reportDir, { withFileTypes: true }).catch(
    () => [],
  );
  const logs: Array<{ name: string; content: string }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".txt")) {
      continue;
    }

    logs.push({
      name: entry.name,
      content: await readFile(path.join(reportDir, entry.name), "utf8"),
    });
  }

  return logs.sort((left, right) => left.name.localeCompare(right.name));
};

export const collectReportSnapshot = async (
  paths: LabPaths,
): Promise<ReportSnapshot> => {
  const stores = await summarizeStores(paths);
  const capturedSessions = await readCapturedHistory(paths);
  const targetSessions = await readTargetSessions(paths);
  const featureMatrix = await collectFeatureMatrix(paths);
  return {
    capturedSessions,
    targetSessions,
    storeCounts: Object.fromEntries(
      stores.map((store) => [
        store.label,
        typeof store.fileCount === "number"
          ? store.fileCount
          : store.sqliteTables
            ? store.sqliteTables
                .map((table) => `${table.name}:${table.rows}`)
                .join(", ")
            : store.exists
              ? "present"
              : "missing",
      ]),
    ),
    featureMatrix,
    conversationParity: collectConversationParity(
      targetSessions,
      featureMatrix,
    ),
  };
};

const collectConversationParity = (
  targetSessions: TargetSessionSummary[],
  featureMatrix: FeatureMatrixRow[],
): ConversationParityRow[] => {
  const targets = [
    "codex",
    "claude",
    "cursor",
    "t3code",
    "opencode",
    "pi",
    "hermes",
    "openclaw",
  ];

  return targets.map((target) => {
    const importedSessions = targetSessions.filter(
      (session) => session.target === target,
    ).length;
    const featureTotal = featureMatrix.length;
    const featureCount = featureMatrix.filter(
      (row) => row.targets[target],
    ).length;
    const storageStatus =
      importedSessions === 0
        ? "missing"
        : featureCount === featureTotal
          ? "pass"
          : "partial";

    return {
      target,
      importedSessions,
      featureCount,
      featureTotal,
      storageStatus,
      visualStatus: visualStatusForTarget(target, storageStatus),
      continuationStatus: continuationStatusForTarget(target, storageStatus),
      notes: parityNotesForTarget(
        target,
        storageStatus,
        featureCount,
        featureTotal,
      ),
    };
  });
};

const visualStatusForTarget = (
  target: string,
  storageStatus: ConversationParityRow["storageStatus"],
): ConversationParityRow["visualStatus"] => {
  if (storageStatus === "missing") {
    return "not checked";
  }
  if (["codex", "claude", "cursor", "opencode", "pi"].includes(target)) {
    return "verified";
  }
  return "manual";
};

const continuationStatusForTarget = (
  target: string,
  storageStatus: ConversationParityRow["storageStatus"],
): ConversationParityRow["continuationStatus"] => {
  if (storageStatus === "missing") {
    return "not checked";
  }
  if (["codex", "cursor", "claude", "opencode", "pi"].includes(target)) {
    return "manual";
  }
  return "not checked";
};

const parityNotesForTarget = (
  target: string,
  storageStatus: ConversationParityRow["storageStatus"],
  featureCount: number,
  featureTotal: number,
): string[] => {
  const notes = [
    `${featureCount}/${featureTotal} fixture feature(s) preserved in stored session data.`,
  ];
  if (target === "codex") {
    notes.push(
      "Codex 0.135 suppresses replayed tool cells, so Poko also writes a visible transcript fallback while preserving structured rows.",
    );
  }
  if (target === "cursor") {
    notes.push("Cursor visual import was verified in the GUI lab.");
  }
  if (target === "t3code") {
    notes.push(
      "T3 Code visual checks require an x86_64 Linux build or local app run.",
    );
  }
  if (storageStatus === "missing") {
    notes.push("No imported target session found for this run.");
  }
  return notes;
};

const readScenarioResult = async (
  reportDir: string,
): Promise<ScenarioResult | undefined> => {
  try {
    return JSON.parse(
      await readFile(path.join(reportDir, "scenario-results.json"), "utf8"),
    ) as ScenarioResult;
  } catch {
    return undefined;
  }
};

const readAcceptanceReport = async (
  reportDir: string,
): Promise<AcceptanceReport | undefined> => {
  try {
    return JSON.parse(
      await readFile(path.join(reportDir, "acceptance-results.json"), "utf8"),
    ) as AcceptanceReport;
  } catch {
    return undefined;
  }
};

const readGateResult = async (
  reportDir: string,
): Promise<GateResult | undefined> => {
  try {
    return JSON.parse(
      await readFile(path.join(reportDir, "gate-results.json"), "utf8"),
    ) as GateResult;
  } catch {
    return undefined;
  }
};

const readCapturedHistory = async (
  paths: LabPaths,
): Promise<SessionSummary[]> => {
  const indexPath = path.join(
    paths.projectDir,
    ".poko",
    "history",
    "index.json",
  );

  try {
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      sessions?: Array<{
        sourceAgent?: string;
        title?: string;
        messageCount?: number;
        path?: string;
      }>;
    };

    return (index.sessions ?? []).map((session) => ({
      source: session.sourceAgent ?? "unknown",
      title: session.title ?? "Untitled",
      messages: session.messageCount ?? 0,
      path: session.path,
    }));
  } catch {
    return [];
  }
};

const readTargetSessions = async (
  paths: LabPaths,
): Promise<TargetSessionSummary[]> => {
  const readers = await Promise.all([
    readCodexTargetSessions(paths),
    readClaudeTargetSessions(paths),
    readCursorTargetSessions(paths),
    readT3TargetSessions(paths),
    readOpenCodeTargetSessions(paths),
    readPiTargetSessions(paths),
    readHermesTargetSessions(paths),
    readOpenClawTargetSessions(paths),
  ]);

  return readers
    .flat()
    .sort((left, right) =>
      `${left.target}:${left.title}`.localeCompare(
        `${right.target}:${right.title}`,
      ),
    );
};

const collectFeatureMatrix = async (
  paths: LabPaths,
): Promise<FeatureMatrixRow[]> => {
  const textByArea = await collectFeatureText(paths);
  const targets = [
    "codex",
    "claude",
    "cursor",
    "t3code",
    "opencode",
    "pi",
    "hermes",
    "openclaw",
  ];

  return FEATURE_CHECKS.map((check) => ({
    feature: check.label,
    needle: check.needle,
    captured: hasFeature(textByArea.captured ?? "", check.patterns),
    targets: Object.fromEntries(
      targets.map((target) => [
        target,
        hasFeature(textByArea[target] ?? "", check.patterns),
      ]),
    ),
  }));
};

const hasFeature = (text: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => text.includes(pattern));

const collectFeatureText = async (
  paths: LabPaths,
): Promise<Record<string, string>> => {
  const env = buildLabEnv(paths);
  const text: Record<string, string> = {};

  text.captured = await readFilesText(
    path.join(paths.projectDir, ".poko", "history"),
  );
  text.codex = await readFilesText(path.join(env.CODEX_HOME, "sessions"));
  text.claude = await readFilesText(
    path.join(env.CLAUDE_CONFIG_DIR, "projects"),
  );
  text.cursor = await readCursorFeatureText(env.POKO_CURSOR_GLOBAL_STATE_DB);
  text.t3code = await readSqliteText(env.POKO_T3CODE_DB_PATH, [
    "select payload_json as text from orchestration_events",
    "select text from projection_thread_messages",
  ]);
  text.opencode = [
    await readFilesText(
      path.join(paths.projectDir, ".poko", "native", "opencode"),
    ),
    await readSqliteText(env.POKO_LAB_OPENCODE_DB, [
      "select title as text from session",
      "select text from part",
    ]),
    await readSqliteText(
      path.join(env.XDG_DATA_HOME, "opencode", "opencode.db"),
      [
        "select title as text from session",
        "select json_extract(data, '$.text') as text from part",
      ],
    ),
  ].join("\n");
  text.pi = await readFilesText(path.join(env.PI_CODING_AGENT_DIR, "sessions"));
  text.hermes = await readSqliteText(path.join(env.HERMES_HOME, "state.db"), [
    "select title as text from sessions",
    "select content as text from messages",
    "select tool_calls as text from messages",
    "select reasoning as text from messages",
  ]);
  text.openclaw = await readFilesText(
    path.join(env.OPENCLAW_STATE_DIR, "agents", "main", "sessions"),
  );

  return text;
};

const readFilesText = async (directory: string): Promise<string> => {
  const files = await walkFiles(directory);
  const chunks: string[] = [];

  for (const filePath of files) {
    try {
      chunks.push(await readFile(filePath, "utf8"));
    } catch {}
  }

  return chunks.join("\n");
};

const readCursorFeatureText = async (dbPath: string): Promise<string> => {
  return readSqliteText(dbPath, [
    "select value as text from ItemTable",
    "select value as text from cursorDiskKV",
  ]);
};

const readSqliteText = async (
  dbPath: string,
  queries: string[],
): Promise<string> => {
  if (!(await pathExists(dbPath))) {
    return "";
  }

  const database = new Database(dbPath, { readonly: true });
  const chunks: string[] = [];

  try {
    for (const query of queries) {
      try {
        const rows = database.query(query).all() as Array<{ text?: unknown }>;
        chunks.push(
          ...rows
            .map((row) =>
              typeof row.text === "string" ? row.text : String(row.text ?? ""),
            )
            .filter(Boolean),
        );
      } catch {}
    }
  } finally {
    database.close();
  }

  return chunks.join("\n");
};

const readCodexTargetSessions = async (
  paths: LabPaths,
): Promise<TargetSessionSummary[]> => {
  const env = buildLabEnv(paths);
  const files = await walkFiles(path.join(env.CODEX_HOME, "sessions"));
  const sessions: TargetSessionSummary[] = [];
  const titleById = await readCodexTitleIndex(env.CODEX_HOME);

  for (const filePath of files.filter((file) => file.endsWith(".jsonl"))) {
    const rows = await readJsonl(filePath);
    const meta = rows.find(
      (
        row,
      ): row is {
        type: string;
        payload: { id: string; originator?: string };
      } =>
        isRecord(row) &&
        row.type === "session_meta" &&
        isRecord(row.payload) &&
        typeof row.payload.id === "string",
    );

    if (!meta?.payload.originator) {
      continue;
    }

    sessions.push({
      target: "codex",
      title: titleById.get(meta.payload.id) ?? "Codex import",
      messages: rows.filter(
        (row) => isRecord(row) && row.type === "response_item",
      ).length,
      location: filePath,
    });
  }

  return sessions;
};

const readCodexTitleIndex = async (
  codexHome: string,
): Promise<Map<string, string>> => {
  const titles = new Map<string, string>();

  for (const row of await readJsonl(
    path.join(codexHome, "session_index.jsonl"),
  )) {
    if (
      isRecord(row) &&
      typeof row.id === "string" &&
      typeof row.thread_name === "string"
    ) {
      titles.set(row.id, row.thread_name);
    }
  }

  return titles;
};

const readClaudeTargetSessions = async (
  paths: LabPaths,
): Promise<TargetSessionSummary[]> => {
  const env = buildLabEnv(paths);
  const files = await walkFiles(path.join(env.CLAUDE_CONFIG_DIR, "projects"));
  const sessions: TargetSessionSummary[] = [];

  for (const filePath of files.filter((file) => file.endsWith(".jsonl"))) {
    const rows = await readJsonl(filePath);

    if (!rows.some((row) => isRecord(row) && row.version === "poko-import")) {
      continue;
    }

    const titleRow = rows.find(
      (row) => isRecord(row) && typeof row.customTitle === "string",
    ) as { customTitle?: string } | undefined;
    sessions.push({
      target: "claude",
      title: titleRow?.customTitle ?? "Claude import",
      messages: rows.filter(
        (row) =>
          isRecord(row) && (row.type === "user" || row.type === "assistant"),
      ).length,
      location: filePath,
    });
  }

  return sessions;
};

const readCursorTargetSessions = async (
  paths: LabPaths,
): Promise<TargetSessionSummary[]> => {
  const env = buildLabEnv(paths);

  if (!(await pathExists(env.POKO_CURSOR_GLOBAL_STATE_DB))) {
    return [];
  }

  const database = new Database(env.POKO_CURSOR_GLOBAL_STATE_DB, {
    readonly: true,
  });

  try {
    const raw = querySqliteString(
      database,
      "select value from ItemTable where key = ?",
      "composer.composerHeaders",
    );

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as { allComposers?: unknown[] };
    return (parsed.allComposers ?? [])
      .filter(isRecord)
      .filter((head) => isRecord(head.pokoImport))
      .map((head) => ({
        target: "cursor",
        title: typeof head.name === "string" ? head.name : "Cursor import",
        messages: countCursorBubbles(database, String(head.composerId ?? "")),
        location: env.POKO_CURSOR_GLOBAL_STATE_DB,
      }));
  } finally {
    database.close();
  }
};

const countCursorBubbles = (database: Database, composerId: string): number => {
  if (!composerId) {
    return 0;
  }

  const row = database
    .query("select count(*) as count from cursorDiskKV where key like ?")
    .get(`bubbleId:${composerId}:%`) as { count?: number } | undefined;
  return row?.count ?? 0;
};

const readT3TargetSessions = async (
  paths: LabPaths,
): Promise<TargetSessionSummary[]> => {
  const env = buildLabEnv(paths);

  if (!(await pathExists(env.POKO_T3CODE_DB_PATH))) {
    return [];
  }

  const database = new Database(env.POKO_T3CODE_DB_PATH, { readonly: true });

  try {
    if (tableExists(database, "projection_threads")) {
      const threads = database
        .query(
          "select thread_id, title from projection_threads order by updated_at desc",
        )
        .all() as Array<{ thread_id: string; title: string }>;

      return threads.map((thread) => ({
        target: "t3code",
        title: thread.title,
        messages: countT3ThreadMessages(database, thread.thread_id),
        location: env.POKO_T3CODE_DB_PATH,
      }));
    }

    const threads = database
      .query(
        "select stream_id, json_extract(payload_json, '$.title') as title from orchestration_events where event_type = 'thread.created' order by occurred_at desc",
      )
      .all() as Array<{ stream_id: string; title?: string }>;

    return threads.map((thread) => ({
      target: "t3code",
      title: thread.title || "T3 Code import",
      messages: countT3ThreadEventMessages(database, thread.stream_id),
      location: env.POKO_T3CODE_DB_PATH,
    }));
  } catch {
    return [];
  } finally {
    database.close();
  }
};

const countT3ThreadMessages = (
  database: Database,
  threadId: string,
): number => {
  const row = database
    .query(
      "select count(*) as count from projection_thread_messages where thread_id = ?",
    )
    .get(threadId) as { count?: number } | undefined;
  return row?.count ?? 0;
};

const countT3ThreadEventMessages = (
  database: Database,
  threadId: string,
): number => {
  const row = database
    .query(
      "select count(*) as count from orchestration_events where stream_id = ? and event_type = 'thread.message-sent'",
    )
    .get(threadId) as { count?: number } | undefined;
  return row?.count ?? 0;
};

const tableExists = (database: Database, tableName: string): boolean =>
  Boolean(
    database
      .query("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(tableName),
  );

const readOpenCodeTargetSessions = async (
  paths: LabPaths,
): Promise<TargetSessionSummary[]> => {
  const env = buildLabEnv(paths);
  const dbPaths = [
    env.POKO_LAB_OPENCODE_DB,
    path.join(env.XDG_DATA_HOME, "opencode", "opencode.db"),
  ];
  const sessions: TargetSessionSummary[] = [];

  for (const dbPath of [...new Set(dbPaths)]) {
    sessions.push(...(await readOpenCodeTargetSessionsFromDb(dbPath)));
  }

  return sessions;
};

const readOpenCodeTargetSessionsFromDb = async (
  dbPath: string,
): Promise<TargetSessionSummary[]> => {
  if (!(await pathExists(dbPath))) {
    return [];
  }

  const database = new Database(dbPath, { readonly: true });

  try {
    const rows = database
      .query("select id, title from session where version = ? order by id")
      .all("poko-import") as Array<{ id: string; title: string }>;

    return rows.map((row) => ({
      target: "opencode",
      title: row.title || "OpenCode import",
      messages: countOpenCodeMessages(database, row.id),
      location: dbPath,
    }));
  } catch {
    return [];
  } finally {
    database.close();
  }
};

const countOpenCodeMessages = (
  database: Database,
  sessionId: string,
): number => {
  const row = database
    .query("select count(*) as count from message where session_id = ?")
    .get(sessionId) as { count?: number } | undefined;
  return row?.count ?? 0;
};

const readPiTargetSessions = async (
  paths: LabPaths,
): Promise<TargetSessionSummary[]> => {
  const env = buildLabEnv(paths);
  const files = await walkFiles(path.join(env.PI_CODING_AGENT_DIR, "sessions"));
  return readPortableJsonlTargets("pi", files);
};

const readOpenClawTargetSessions = async (
  paths: LabPaths,
): Promise<TargetSessionSummary[]> => {
  const env = buildLabEnv(paths);
  const files = await walkFiles(
    path.join(env.OPENCLAW_STATE_DIR, "agents", "main", "sessions"),
  );
  return readPortableJsonlTargets("openclaw", files);
};

const readPortableJsonlTargets = async (
  target: string,
  files: string[],
): Promise<TargetSessionSummary[]> => {
  const sessions: TargetSessionSummary[] = [];

  for (const filePath of files.filter((file) => file.endsWith(".jsonl"))) {
    const rows = await readJsonl(filePath);

    if (
      !rows.some((row) => isRecord(row) && row.customType === "poko.import")
    ) {
      continue;
    }

    const titleRow = rows.find(
      (row) =>
        isRecord(row) &&
        row.type === "session_info" &&
        typeof row.name === "string",
    ) as { name?: string } | undefined;
    sessions.push({
      target,
      title: titleRow?.name ?? `${target} import`,
      messages: rows.filter((row) => isRecord(row) && row.type === "message")
        .length,
      location: filePath,
    });
  }

  return sessions;
};

const readHermesTargetSessions = async (
  paths: LabPaths,
): Promise<TargetSessionSummary[]> => {
  const env = buildLabEnv(paths);
  const dbPath = path.join(env.HERMES_HOME, "state.db");

  if (!(await pathExists(dbPath))) {
    return [];
  }

  const database = new Database(dbPath, { readonly: true });

  try {
    const rows = database
      .query(
        "select id, title from sessions where source = ? order by started_at desc",
      )
      .all("poko") as Array<{ id: string; title: string }>;

    return rows.map((row) => ({
      target: "hermes",
      title: row.title || "Hermes import",
      messages: countHermesMessages(database, row.id),
      location: dbPath,
    }));
  } catch {
    return [];
  } finally {
    database.close();
  }
};

const countHermesMessages = (database: Database, sessionId: string): number => {
  const row = database
    .query("select count(*) as count from messages where session_id = ?")
    .get(sessionId) as { count?: number } | undefined;
  return row?.count ?? 0;
};

const renderReport = (
  paths: LabPaths,
  stores: StoreSummary[],
  logs: Array<{ name: string; content: string }>,
  snapshot: ReportSnapshot,
  scenario?: ScenarioResult,
  acceptance?: AcceptanceReport,
  gate?: GateResult,
): string => {
  const generatedAt = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Poko Lab Report</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f7f4;
      --panel: #ffffff;
      --text: #1d1d1b;
      --muted: #686864;
      --line: #d9d8d0;
      --ok: #18794e;
      --missing: #a33a2a;
      --accent: #4a72c9;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #171816;
        --panel: #20211f;
        --text: #eeeeea;
        --muted: #aeaea8;
        --line: #373832;
        --ok: #5ac48a;
        --missing: #ff8a7a;
        --accent: #92b4ff;
      }
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      letter-spacing: 0;
    }
    h2 {
      margin: 28px 0 12px;
      font-size: 18px;
      letter-spacing: 0;
    }
    .meta {
      color: var(--muted);
      margin-bottom: 18px;
    }
    .grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      min-width: 0;
    }
    .title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
      font-weight: 700;
    }
    .badge {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 8px;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .ok {
      color: var(--ok);
    }
    .missing {
      color: var(--missing);
    }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    code {
      overflow-wrap: anywhere;
    }
    ul {
      margin: 8px 0 0;
      padding-left: 18px;
    }
    pre {
      margin: 0;
      overflow: auto;
      background: color-mix(in srgb, var(--panel) 78%, black);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      max-height: 420px;
    }
    .kv {
      display: grid;
      gap: 6px;
    }
    .kv div {
      min-width: 0;
    }
    .muted {
      color: var(--muted);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    tr:last-child td {
      border-bottom: 0;
    }
  </style>
</head>
<body>
<main>
  <h1>Poko Lab Report</h1>
  <div class="meta">Generated ${escapeHtml(generatedAt)} for profile <code>${escapeHtml(paths.profile)}</code>, run <code>${escapeHtml(paths.run)}</code>.</div>

  <section class="card">
    <div class="kv">
      <div><strong>Workspace:</strong> <code>${escapeHtml(paths.projectDir)}</code></div>
      <div><strong>Run home:</strong> <code>${escapeHtml(paths.runHome)}</code></div>
      <div><strong>Auth baseline:</strong> <code>${escapeHtml(paths.baselineHome)}</code></div>
      <div><strong>Reset:</strong> <code>bun lab/poko-lab.ts reset</code> preserves auth; <code>reset --include-auth --yes</code> clears it.</div>
    </div>
  </section>

  ${scenario ? renderScenario(scenario) : ""}
  ${gate ? renderGate(gate) : ""}
  ${acceptance ? renderAcceptance(acceptance) : ""}

  <h2>Captured History</h2>
  ${renderCapturedSessions(snapshot.capturedSessions)}

  <h2>Native Target Sessions</h2>
  ${renderTargetSessions(snapshot.targetSessions)}

  <h2>Conversation Parity</h2>
  ${renderConversationParity(snapshot.conversationParity)}

  <h2>Feature Matrix</h2>
  ${renderFeatureMatrix(snapshot.featureMatrix)}

  <h2>Agent Stores</h2>
  <section class="grid">
    ${stores.map(renderStoreCard).join("\n")}
  </section>

  ${logs.length > 0 ? `<h2>Command Logs</h2>${logs.map(renderLog).join("\n")}` : ""}
</main>
</body>
</html>
`;
};

const renderScenario = (scenario: ScenarioResult): string => `
<h2>Scenario</h2>
<section class="card">
  <div class="title">
    <span>${escapeHtml(scenario.name)}</span>
    <span class="badge">${escapeHtml(scenario.mode)}</span>
  </div>
  <div class="kv">
    <div><strong>Sources:</strong> ${escapeHtml(scenario.sources.join(", ") || "none")}</div>
    <div><strong>Targets:</strong> ${escapeHtml(scenario.targets.join(", ") || "none")}</div>
    <div><strong>Commands:</strong> ${scenario.commands.map((command) => `<code>${escapeHtml(command.label)}</code> exit ${command.exitCode}`).join(", ") || "none"}</div>
    <div><strong>Before:</strong> ${scenario.before.capturedSessions.length} captured, ${scenario.before.targetSessions.length} native target session(s)</div>
    <div><strong>After:</strong> ${scenario.after.capturedSessions.length} captured, ${scenario.after.targetSessions.length} native target session(s)</div>
    ${scenario.notes.map((note) => `<div class="muted">${escapeHtml(note)}</div>`).join("")}
  </div>
</section>`;

const renderGate = (gate: GateResult): string => `
<h2>Launch Gate</h2>
<section class="card">
  <div class="title">
    <span>${escapeHtml(gate.passed ? "Ready for paid-launch review" : "Needs hardening")}</span>
    <span class="badge ${gate.passed ? "ok" : "missing"}">${escapeHtml(gate.passed ? "pass" : "fail")}</span>
  </div>
  <div class="muted">Generated ${escapeHtml(gate.gatedAt)}. Manual rows are expected for real-app visual screenshots and do not fail the synthetic CI gate.</div>
</section>
<table>
  <thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
  <tbody>
    ${gate.checks
      .map(
        (check) => `<tr>
          <td>${escapeHtml(check.name)}</td>
          <td class="${check.status === "pass" ? "ok" : check.status === "fail" ? "missing" : ""}">${escapeHtml(check.status)}</td>
          <td>${escapeHtml(check.detail)}</td>
        </tr>`,
      )
      .join("")}
  </tbody>
</table>`;

const renderAcceptance = (acceptance: AcceptanceReport): string => `
<h2>Agent Acceptance</h2>
<section class="card">
  <div class="title">
    <span>Real Agent Surface Checks</span>
    <span class="badge">${escapeHtml(acceptance.prepared ? "prepared" : "current run")}</span>
  </div>
  <div class="muted">Generated ${escapeHtml(acceptance.acceptedAt)}. Automated checks launch real CLIs when a stable non-network list/export surface exists; GUI/TUI checks are marked manual with exact commands.</div>
</section>
<table>
  <thead><tr><th>Agent</th><th>Surface</th><th>Status</th><th>Command</th><th>Expected Titles</th><th>Notes</th></tr></thead>
  <tbody>
    ${acceptance.results
      .map(
        (result) => `<tr>
          <td>${escapeHtml(result.agent)}</td>
          <td>${escapeHtml(result.surface)}</td>
          <td>${escapeHtml(result.status)}</td>
          <td><code>${escapeHtml(result.command ?? "")}</code></td>
          <td>${result.expectedTitles.map((title) => `<div>${escapeHtml(title)}</div>`).join("")}</td>
          <td>${result.notes.map((note) => `<div>${escapeHtml(note)}</div>`).join("")}${result.logFile ? `<div><code>${escapeHtml(result.logFile)}</code></div>` : ""}</td>
        </tr>`,
      )
      .join("")}
  </tbody>
</table>`;

const renderCapturedSessions = (sessions: SessionSummary[]): string => {
  if (sessions.length === 0) {
    return `<section class="card muted">No captured Poko history yet. Run <code>bun lab/poko-lab.ts smoke --write</code> or a write scenario.</section>`;
  }

  return `<table>
    <thead><tr><th>Source</th><th>Title</th><th>Messages</th><th>Path</th></tr></thead>
    <tbody>
      ${sessions
        .map(
          (session) =>
            `<tr><td>${escapeHtml(session.source)}</td><td>${escapeHtml(session.title)}</td><td>${session.messages}</td><td><code>${escapeHtml(session.path ?? "")}</code></td></tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
};

const renderTargetSessions = (sessions: TargetSessionSummary[]): string => {
  if (sessions.length === 0) {
    return `<section class="card muted">No native target sessions written yet. Dry runs intentionally leave this empty.</section>`;
  }

  return `<table>
    <thead><tr><th>Target</th><th>Title</th><th>Messages</th><th>Location</th></tr></thead>
    <tbody>
      ${sessions
        .map(
          (session) =>
            `<tr><td>${escapeHtml(session.target)}</td><td>${escapeHtml(session.title)}</td><td>${session.messages}</td><td><code>${escapeHtml(session.location)}</code></td></tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
};

const renderConversationParity = (rows: ConversationParityRow[]): string => {
  if (rows.length === 0) {
    return `<section class="card muted">No conversation parity checks were configured.</section>`;
  }

  return `<section class="card">
    <div class="title">
      <span>Same Conversation Everywhere</span>
      <span class="badge">lab evidence</span>
    </div>
    <div class="muted">Poko's product goal is that a chat can move between agents and still feel like the same working conversation. This table shows the current evidence for that promise in this lab run.</div>
  </section>
  <table>
    <thead><tr><th>Target</th><th>Imported</th><th>Fixture Features</th><th>Storage</th><th>Visual</th><th>Continuation</th><th>Notes</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (row) => `<tr>
            <td>${escapeHtml(row.target)}</td>
            <td>${row.importedSessions}</td>
            <td>${row.featureCount}/${row.featureTotal}</td>
            <td class="${row.storageStatus === "pass" ? "ok" : row.storageStatus === "missing" ? "missing" : ""}">${escapeHtml(row.storageStatus)}</td>
            <td>${escapeHtml(row.visualStatus)}</td>
            <td>${escapeHtml(row.continuationStatus)}</td>
            <td>${row.notes.map((note) => `<div>${escapeHtml(note)}</div>`).join("")}</td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
};

const renderFeatureMatrix = (rows: FeatureMatrixRow[]): string => {
  if (rows.length === 0) {
    return `<section class="card muted">No feature checks were configured.</section>`;
  }

  const targets = [
    "captured",
    "codex",
    "claude",
    "cursor",
    "t3code",
    "opencode",
    "pi",
    "hermes",
    "openclaw",
  ];

  return `<table>
    <thead><tr><th>Feature</th><th>Needle</th>${targets
      .map((target) => `<th>${escapeHtml(target)}</th>`)
      .join("")}</tr></thead>
    <tbody>
      ${rows
        .map(
          (row) => `<tr>
            <td>${escapeHtml(row.feature)}</td>
            <td><code>${escapeHtml(row.needle)}</code></td>
            ${targets
              .map((target) => {
                const present =
                  target === "captured" ? row.captured : row.targets[target];
                return `<td class="${present ? "ok" : "missing"}">${present ? "yes" : "no"}</td>`;
              })
              .join("")}
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
};

const renderStoreCard = (store: StoreSummary): string => `
<article class="card">
  <div class="title">
    <span>${escapeHtml(store.label)}</span>
    <span class="badge ${store.exists ? "ok" : "missing"}">${store.exists ? "present" : "missing"}</span>
  </div>
  <div class="muted">${escapeHtml(store.description)}</div>
  <p><code>${escapeHtml(store.path)}</code></p>
  ${typeof store.fileCount === "number" ? `<div>${store.fileCount} file(s)</div>` : ""}
  ${store.sqliteTables ? renderSqliteTables(store.sqliteTables) : ""}
  ${store.sampleFiles && store.sampleFiles.length > 0 ? renderSampleFiles(store.sampleFiles) : ""}
</article>`;

const renderSqliteTables = (
  tables: Array<{ name: string; rows: number | string }>,
): string =>
  `<ul>${tables
    .map(
      (table) =>
        `<li><code>${escapeHtml(table.name)}</code>: ${escapeHtml(String(table.rows))}</li>`,
    )
    .join("")}</ul>`;

const renderSampleFiles = (files: string[]): string =>
  `<ul>${files
    .map((file) => `<li><code>${escapeHtml(file)}</code></li>`)
    .join("")}</ul>`;

const renderLog = (log: { name: string; content: string }): string => `
<section>
  <h2>${escapeHtml(log.name)}</h2>
  <pre>${escapeHtml(redactSecrets(log.content))}</pre>
</section>`;

export const formatCommandLog = (
  args: string[],
  result: CommandResult,
): string =>
  [
    `$ ${args.map(shellQuote).join(" ")}`,
    `exit ${result.exitCode}`,
    "",
    "stdout:",
    result.stdout.trimEnd(),
    "",
    "stderr:",
    result.stderr.trimEnd(),
    "",
  ].join("\n");

const copyProjectWorkspace = async (
  repoRoot: string,
  destination: string,
): Promise<void> => {
  await rm(destination, { recursive: true, force: true });
  await copyTree(repoRoot, destination, shouldCopyProjectPath);
};

const ensureLabHomeSkeleton = async (paths: LabPaths): Promise<void> => {
  const env = buildLabEnv(paths);
  await Promise.all([
    mkdir(env.CODEX_HOME, { recursive: true }),
    mkdir(path.join(env.CLAUDE_CONFIG_DIR, "projects"), { recursive: true }),
    mkdir(path.dirname(env.POKO_CURSOR_GLOBAL_STATE_DB), { recursive: true }),
    mkdir(env.POKO_CURSOR_STORAGE_ROOT, { recursive: true }),
    mkdir(path.dirname(env.POKO_T3CODE_DB_PATH), { recursive: true }),
    mkdir(env.HERMES_HOME, { recursive: true }),
    mkdir(env.OPENCLAW_STATE_DIR, { recursive: true }),
    mkdir(env.PI_CODING_AGENT_DIR, { recursive: true }),
    mkdir(env.XDG_CONFIG_HOME, { recursive: true }),
    mkdir(env.XDG_DATA_HOME, { recursive: true }),
    mkdir(env.XDG_STATE_HOME, { recursive: true }),
    mkdir(path.dirname(env.POKO_OPENCODE_BIN), { recursive: true }),
    mkdir(path.dirname(env.POKO_LAB_OPENCODE_DB), { recursive: true }),
  ]);
  createCursorGlobalStateDb(env.POKO_CURSOR_GLOBAL_STATE_DB);
  createT3CodeStateDb(env.POKO_T3CODE_DB_PATH);
  createOpenCodeStateDb(env.POKO_LAB_OPENCODE_DB);
  await writeFakeOpenCodeBin(paths);
};

const createCursorGlobalStateDb = (dbPath: string): void => {
  const database = new Database(dbPath);

  try {
    database.run(
      "create table if not exists ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
    );
    database.run(
      "create table if not exists cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
    );
  } finally {
    database.close();
  }
};

const createT3CodeStateDb = (dbPath: string): void => {
  const database = new Database(dbPath);

  try {
    // Keep this fixture pre-projection. Real T3 Code can then run its own
    // migrations before projecting Poko-imported events into UI tables.
    database.run(`
      create table if not exists orchestration_events (
        sequence integer primary key autoincrement,
        event_id text not null unique,
        aggregate_kind text not null,
        stream_id text not null,
        stream_version integer not null,
        event_type text not null,
        occurred_at text not null,
        command_id text,
        causation_event_id text,
        correlation_id text,
        actor_kind text not null,
        payload_json text not null,
        metadata_json text not null
      )
    `);
    database.run(`
      create unique index if not exists idx_orch_events_stream_version
      on orchestration_events(aggregate_kind, stream_id, stream_version)
    `);
  } finally {
    database.close();
  }
};

const createOpenCodeStateDb = (dbPath: string): void => {
  const database = new Database(dbPath);

  try {
    database.run(
      "create table if not exists session (id text primary key, version text, directory text, title text)",
    );
    database.run(
      "create table if not exists message (id text primary key, session_id text, role text)",
    );
    database.run(
      "create table if not exists part (id text primary key, session_id text, message_id text, text text)",
    );
  } finally {
    database.close();
  }
};

const writeFakeOpenCodeBin = async (paths: LabPaths): Promise<void> => {
  const env = buildLabEnv(paths);
  const script = `#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { appendFile, readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const dbPath = ${JSON.stringify(env.POKO_LAB_OPENCODE_DB)};
const logPath = ${JSON.stringify(path.join(paths.runDir, "opencode-import.log"))};

if (args[0] === "models") {
  console.log("opencode/big-pickle");
  process.exit(0);
}

if (args[0] === "db" && args[1] === "path") {
  console.log(dbPath);
  process.exit(0);
}

if (args[0] === "import" && args[1]) {
  const raw = await readFile(args[1], "utf8");
  const payload = JSON.parse(raw);
  const database = new Database(dbPath);
  try {
    database.run("create table if not exists session (id text primary key, version text, directory text, title text)");
    database.run("create table if not exists message (id text primary key, session_id text, role text)");
    database.run("create table if not exists part (id text primary key, session_id text, message_id text, text text)");
    database
      .query("insert or replace into session (id, version, directory, title) values (?, ?, ?, ?)")
      .run(payload.info.id, payload.info.version ?? "poko-import", payload.info.directory ?? "", payload.info.title ?? "");

    for (const message of payload.messages ?? []) {
      database
        .query("insert or replace into message (id, session_id, role) values (?, ?, ?)")
        .run(message.info.id, payload.info.id, message.info.role ?? "");
      for (const part of message.parts ?? []) {
        database
          .query("insert or replace into part (id, session_id, message_id, text) values (?, ?, ?, ?)")
          .run(part.id, payload.info.id, message.info.id, part.text ?? "");
      }
    }
  } finally {
    database.close();
  }
  await appendFile(logPath, \`import \${args[1]}\\n\`, "utf8");
  process.exit(0);
}

console.error(\`fake opencode: unsupported command \${args.join(" ")}\`);
process.exit(1);
`;

  await writeFile(env.POKO_OPENCODE_BIN, script, "utf8");
  await chmod(env.POKO_OPENCODE_BIN, 0o755);
};

const copyTree = async (
  source: string,
  destination: string,
  filter: (relativePath: string, entryName: string) => boolean = () => true,
  relativePath = "",
): Promise<void> => {
  const entryStats = await lstat(source).catch(() => undefined);

  if (!entryStats || entryStats.isSymbolicLink()) {
    return;
  }

  if (entryStats.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      const childRelativePath = relativePath
        ? path.join(relativePath, entry.name)
        : entry.name;

      if (!filter(normalizePath(childRelativePath), entry.name)) {
        continue;
      }

      await copyTree(
        path.join(source, entry.name),
        path.join(destination, entry.name),
        filter,
        childRelativePath,
      );
    }

    return;
  }

  if (entryStats.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
};

const shouldCopyProjectPath = (
  relativePath: string,
  entryName: string,
): boolean => {
  const skippedNames = new Set([
    ".DS_Store",
    ".git",
    ".research",
    "bin",
    "dist",
    "node_modules",
  ]);
  const skippedPaths = new Set([
    ".poko/handoffs",
    ".poko/history",
    ".poko/native",
    "lab/.state",
    "lab/profiles",
    "lab/reports",
    "lab/runs",
    ".agents",
    ".claude",
    ".codex",
    ".cursor",
    ".pi",
    ".cursorrules",
    ".mcp.json",
    "AGENTS.md",
    "CLAUDE.md",
    "opencode.json",
  ]);

  return !skippedNames.has(entryName) && !skippedPaths.has(relativePath);
};

const walkFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const files: string[] = [];

  for (const entry of entries) {
    const childPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(childPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(childPath);
    }
  }

  return files.sort();
};

const directoryHasEntries = async (directory: string): Promise<boolean> => {
  try {
    return (await readdir(directory)).length > 0;
  } catch {
    return false;
  }
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const readJsonl = async (filePath: string): Promise<unknown[]> => {
  try {
    return (await readFile(filePath, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
  } catch {
    return [];
  }
};

const renderJsonl = (rows: unknown[]): string =>
  `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

const commandPath = async (binary: string): Promise<string | undefined> => {
  const result = await runHostCommand([
    "sh",
    "-lc",
    `command -v ${shellQuote(binary)}`,
  ]);
  const resolved = result.stdout.trim();
  return result.exitCode === 0 && resolved.length > 0 ? resolved : undefined;
};

const runHostCommand = async (args: string[]): Promise<CommandResult> => {
  const child = Bun.spawn(args, {
    cwd: process.cwd(),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { exitCode, stdout, stderr };
};

const querySqliteString = (
  database: Database,
  sql: string,
  value: string,
): string | undefined => {
  try {
    const row = database.query(sql).get(value) as
      | { value?: string | Buffer }
      | undefined;

    if (typeof row?.value === "string") {
      return row.value;
    }

    if (row?.value instanceof Buffer) {
      return row.value.toString("utf8");
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const createHermesStateSchema = (database: Database): void => {
  database.run(`
    create table if not exists sessions (
      id text primary key,
      source text not null,
      user_id text,
      model text,
      model_config text,
      system_prompt text,
      parent_session_id text,
      started_at real not null,
      ended_at real,
      end_reason text,
      message_count integer default 0,
      tool_call_count integer default 0,
      input_tokens integer default 0,
      output_tokens integer default 0,
      cache_read_tokens integer default 0,
      cache_write_tokens integer default 0,
      reasoning_tokens integer default 0,
      title text,
      api_call_count integer default 0
    )
  `);
  database.run(`
    create table if not exists messages (
      id integer primary key autoincrement,
      session_id text not null,
      role text not null,
      content text,
      timestamp real not null
    )
  `);
};

const encodeClaudeProjectPath = (projectRoot: string): string =>
  projectRoot.normalize("NFC").replace(/[^a-zA-Z0-9]/g, "-");

const encodePiProjectPath = (projectRoot: string): string =>
  `--${path
    .resolve(projectRoot)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const resolveLabRoot = (value?: string): string =>
  normalizeMacSystemPath(
    path.resolve(
      value ??
        process.env.POKO_LAB_ROOT ??
        path.join(os.homedir(), ".poko", "lab"),
    ),
  );

const normalizeMacSystemPath = (value: string): string => {
  if (process.platform !== "darwin") {
    return value;
  }

  if (value === "/tmp" || value.startsWith("/tmp/")) {
    return `/private${value}`;
  }

  if (value === "/var" || value.startsWith("/var/")) {
    return `/private${value}`;
  }

  return value;
};

export const defaultPokoCommand = (
  repoRoot: string,
  command: string,
  ...args: string[]
): string[] => ["bun", path.join(repoRoot, "src", "cli.ts"), command, ...args];

const parseArgs = (argv: string[]): ParsedArgs => {
  const command = argv[0]?.startsWith("-") ? undefined : argv[0];
  const rest = command ? argv.slice(1) : argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--") {
      positional.push(...rest.slice(index + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = arg.slice(2).split("=", 2);

      if (inlineValue !== undefined) {
        flags[rawKey] = inlineValue;
        continue;
      }

      const next = rest[index + 1];

      if (next && !next.startsWith("-") && expectsValue(rawKey)) {
        flags[rawKey] = next;
        index += 1;
        continue;
      }

      flags[rawKey] = true;
      continue;
    }

    positional.push(arg);
  }

  return { command, positional, flags };
};

const expectsValue = (flag: string): boolean =>
  ["agent", "profile", "root", "run"].includes(flag);

const parseSeedAgents = (
  value: string | undefined,
): SeedAgent[] | undefined => {
  if (!value || value === "all") {
    return undefined;
  }

  const agents = value
    .split(",")
    .map((agent) => agent.trim())
    .filter(Boolean);

  for (const agent of agents) {
    if (!SEED_AGENTS.includes(agent as SeedAgent)) {
      throw new Error(
        `Unknown seed agent "${agent}". Supported seed agents: ${SEED_AGENTS.join(", ")}.`,
      );
    }
  }

  return agents as SeedAgent[];
};

const parseAcceptanceAgents = (
  value: string | undefined,
): AcceptanceAgent[] | undefined => {
  if (!value || value === "all") {
    return undefined;
  }

  const agents = value
    .split(",")
    .map((agent) => agent.trim())
    .filter(Boolean);

  for (const agent of agents) {
    if (!ACCEPTANCE_AGENTS.includes(agent as AcceptanceAgent)) {
      throw new Error(
        `Unknown acceptance agent "${agent}". Supported agents: ${ACCEPTANCE_AGENTS.join(", ")}.`,
      );
    }
  }

  return agents as AcceptanceAgent[];
};

const parseAuthAgents = (
  value: string | undefined,
): AuthAgent[] | undefined => {
  if (!value || value === "all") {
    return undefined;
  }

  const agents = value
    .split(",")
    .map((agent) => agent.trim())
    .filter(Boolean);

  for (const agent of agents) {
    if (!AUTH_AGENTS.includes(agent as AuthAgent)) {
      throw new Error(
        `Unknown auth agent "${agent}". Supported agents: ${AUTH_AGENTS.join(", ")}.`,
      );
    }
  }

  return agents as AuthAgent[];
};

const parseScenarioName = (value: string): ScenarioName => {
  if (value === "reset-modes" || value in SCENARIOS) {
    return value as ScenarioName;
  }

  throw new Error(
    `Unknown scenario "${value}". Run \`bun lab/poko-lab.ts scenario list\`.`,
  );
};

const printScenarios = (): void => {
  console.log("Scenarios:");
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    console.log(`  ${name}: ${scenario.description}`);
  }
  console.log(
    "  reset-modes: Demonstrates auth-preserving reset and explicit auth nuke in a demo profile.",
  );
};

const flagString = (value: string | boolean | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const stripLeadingSeparator = (args: string[]): string[] =>
  args[0] === "--" ? args.slice(1) : args;

const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;

const normalizePath = (value: string): string =>
  value.split(path.sep).join("/");

const quoteSqlIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const redactSecrets = (value: string): string =>
  value.replace(
    /\b([A-Za-z0-9_]*(?:token|secret|key|password)[A-Za-z0-9_]*)=([^\s]+)/gi,
    "$1=[redacted]",
  );

const helpText = (): string => `${pc.bold("poko lab")}

Usage:
  bun lab/poko-lab.ts doctor [--profile <name>] [--run <name>]
  bun lab/poko-lab.ts reset [--include-auth --yes]
  bun lab/poko-lab.ts snapshot-auth [--force]
  bun lab/poko-lab.ts import-auth [--agent codex,claude,cursor,t3code,opencode,pi,hermes,openclaw] [--force] [--reset]
  bun lab/poko-lab.ts env [--json]
  bun lab/poko-lab.ts seed [--agent codex,claude,cursor,pi,hermes,openclaw]
  bun lab/poko-lab.ts scenario <name|list> [--write] [--no-reset]
  bun lab/poko-lab.ts accept [--prepare] [--agent opencode,codex,claude,cursor,t3code,pi,hermes,openclaw]
  bun lab/poko-lab.ts run -- <command...>
  bun lab/poko-lab.ts smoke [--write] [--no-reset]
  bun lab/poko-lab.ts gate [--no-reset]
  bun lab/poko-lab.ts report

Options:
  --root <path>       Lab root. Defaults to POKO_LAB_ROOT or ~/.poko/lab.
  --profile <name>   Signed-in baseline profile. Defaults to default.
  --run <name>       Disposable run name. Defaults to current.

Reset levels:
  reset                       Clears disposable test data and restores auth baseline.
  reset --include-auth --yes  Clears test data and saved login/auth state.
`;

if (import.meta.main) {
  cli().then(
    (code) => process.exit(code),
    (error) => {
      console.error(
        `${pc.red("poko-lab")} ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    },
  );
}
