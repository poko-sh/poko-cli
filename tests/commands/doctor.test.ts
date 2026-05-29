import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runDoctor } from "../../src/commands/doctor.ts";
import { runInit } from "../../src/commands/init.ts";
import { createMemoryLogger, makeTempDir, removeTempDir } from "../helpers.ts";

let cwd: string;
let codexHome: string;
let piHome: string;
let oldCodexHome: string | undefined;
let oldPiAgentDir: string | undefined;

beforeEach(async () => {
  cwd = await makeTempDir();
  codexHome = await makeTempDir();
  piHome = await makeTempDir();
  oldCodexHome = process.env.CODEX_HOME;
  oldPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.CODEX_HOME = codexHome;
  process.env.PI_CODING_AGENT_DIR = piHome;
  await runInit({ cwd, logger: createMemoryLogger() });
  await writeFile(
    path.join(cwd, ".poko/rules.md"),
    "# Project Rules\n\nShip carefully.\n",
    "utf8",
  );
});

afterEach(async () => {
  restoreEnv("CODEX_HOME", oldCodexHome);
  restoreEnv("PI_CODING_AGENT_DIR", oldPiAgentDir);
  await removeTempDir(cwd);
  await removeTempDir(codexHome);
  await removeTempDir(piHome);
});

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
};

describe("poko doctor", () => {
  test("reports project, source, adapters, history, and native dry-run status", async () => {
    await configureRepoHistoryStore();
    await seedCodexSession();
    const logger = createMemoryLogger();

    await runDoctor({ cwd, logger });

    const output = logger.messages.join("\n");
    expect(output).toContain("poko doctor");
    expect(output).toContain("Project");
    expect(output).toContain(`root: ${cwd}`);
    expect(output).toContain("Source Context");
    expect(output).toContain("rules.md: present");
    expect(output).toContain("Adapters");
    expect(output).toContain("claude: enabled");
    expect(output).toContain("History Capture");
    expect(output).toContain("codex: enabled, 1 current session");
    expect(output).toContain("Native Sync Dry Run");
    expect(output).toContain("claude: would sync 1 session(s), 2 message(s)");
    expect(output).toContain("sessionsSkippedFromSameAgent=0");
    expect(output).toContain("Warnings");
  });

  test("warns when the project has not been initialized", async () => {
    const uninitialized = await makeTempDir();
    const logger = createMemoryLogger();

    try {
      await runDoctor({ cwd: uninitialized, logger });
      expect(logger.messages.join("\n")).toContain("not initialized");
    } finally {
      await removeTempDir(uninitialized);
    }
  });
});

const configureRepoHistoryStore = async (): Promise<void> => {
  const configPath = path.join(cwd, ".poko/poko.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    project?: { id?: string; createdAt?: string };
    history?: { defaultStore?: string };
  };
  config.project = {
    id: "doctor-test-project",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  config.history = {
    ...config.history,
    defaultStore: "repo",
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
};

const seedCodexSession = async (): Promise<void> => {
  const sessionPath = path.join(
    codexHome,
    "sessions/2026/05/29/rollout-2026-05-29T00-00-00-doctor-session.jsonl",
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        timestamp: "2026-05-29T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "doctor-session",
          timestamp: "2026-05-29T00:00:00.000Z",
          cwd,
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-29T00:00:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "doctor check" },
      }),
      JSON.stringify({
        timestamp: "2026-05-29T00:00:02.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "all clear" },
      }),
    ].join("\n"),
    "utf8",
  );
  await mkdir(codexHome, { recursive: true });
  await appendFile(
    path.join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({ id: "doctor-session", thread_name: "Doctor test" })}\n`,
    "utf8",
  );
};
