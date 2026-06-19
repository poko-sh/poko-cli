import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runGate } from "../../lab/gate.ts";
import {
  buildLabEnv,
  createLabPaths,
  resetLab,
  seedLab,
  snapshotAuth,
  writeReport,
} from "../../lab/poko-lab.ts";
import { makeTempDir, removeTempDir } from "../helpers.ts";

describe("poko lab", () => {
  test("reset copies a clean workspace and excludes generated state", async () => {
    const tempDir = await makeTempDir();

    try {
      const repoRoot = path.join(tempDir, "repo");
      const labRoot = path.join(tempDir, "lab");
      await writeRepoFixture(repoRoot);

      const paths = await resetLab({ repoRoot, root: labRoot });

      await expect(
        fileExists(path.join(paths.projectDir, "src", "index.ts")),
      ).resolves.toBe(true);
      await expect(
        fileExists(path.join(paths.projectDir, ".poko", "poko.json")),
      ).resolves.toBe(true);
      await expect(
        fileExists(path.join(paths.projectDir, "node_modules", "pkg.js")),
      ).resolves.toBe(false);
      await expect(
        fileExists(path.join(paths.projectDir, ".git", "HEAD")),
      ).resolves.toBe(false);
      await expect(
        fileExists(
          path.join(paths.projectDir, ".poko", "native", "payload.json"),
        ),
      ).resolves.toBe(false);
      await expect(
        fileExists(path.join(paths.projectDir, "lab", ".state", "token.txt")),
      ).resolves.toBe(false);
      await expect(
        fileExists(path.join(paths.projectDir, "AGENTS.md")),
      ).resolves.toBe(false);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  test("reset preserves auth baseline unless include-auth is explicit", async () => {
    const tempDir = await makeTempDir();

    try {
      const repoRoot = path.join(tempDir, "repo");
      const labRoot = path.join(tempDir, "lab");
      await writeRepoFixture(repoRoot);

      let paths = await resetLab({ repoRoot, root: labRoot });
      const authFile = path.join(
        paths.runHome,
        ".config",
        "agent",
        "token.txt",
      );
      await mkdir(path.dirname(authFile), { recursive: true });
      await writeFile(authFile, "signed-in", "utf8");
      await snapshotAuth({ root: labRoot, force: true });

      await rm(authFile, { force: true });
      paths = await resetLab({ repoRoot, root: labRoot });
      await expect(
        readFile(
          path.join(paths.runHome, ".config", "agent", "token.txt"),
          "utf8",
        ),
      ).resolves.toBe("signed-in");

      await resetLab({
        repoRoot,
        root: labRoot,
        includeAuth: true,
        yes: true,
      });
      paths = createLabPaths({ root: labRoot });
      await expect(
        fileExists(path.join(paths.runHome, ".config", "agent", "token.txt")),
      ).resolves.toBe(false);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  test("report writes an html summary without requiring agent stores", async () => {
    const tempDir = await makeTempDir();

    try {
      const repoRoot = path.join(tempDir, "repo");
      const labRoot = path.join(tempDir, "lab");
      await writeRepoFixture(repoRoot);
      await resetLab({ repoRoot, root: labRoot });

      const reportPath = await writeReport({ root: labRoot });
      const report = await readFile(reportPath, "utf8");

      expect(report).toContain("Poko Lab Report");
      expect(report).toContain("reset --include-auth --yes");
      expect(report).toContain("Codex sessions");
      expect(report).toContain("Conversation Parity");
      expect(report).toContain("Same Conversation Everywhere");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  test("seed writes realistic isolated source histories", async () => {
    const tempDir = await makeTempDir();

    try {
      const repoRoot = path.join(tempDir, "repo");
      const labRoot = path.join(tempDir, "lab");
      await writeRepoFixture(repoRoot);
      const paths = await resetLab({ repoRoot, root: labRoot });
      await seedLab({ root: labRoot, agents: ["codex", "cursor", "hermes"] });
      const env = buildLabEnv(paths);

      await expect(
        fileExists(
          path.join(
            env.CODEX_HOME,
            "sessions",
            "2026",
            "05",
            "29",
            "rollout-2026-05-29T09-00-00-lab-codex-session.jsonl",
          ),
        ),
      ).resolves.toBe(true);
      await expect(fileExists(env.POKO_CURSOR_GLOBAL_STATE_DB)).resolves.toBe(
        true,
      );
      await expect(
        fileExists(path.join(env.HERMES_HOME, "state.db")),
      ).resolves.toBe(true);

      const config = JSON.parse(
        await readFile(
          path.join(paths.projectDir, ".poko", "poko.json"),
          "utf8",
        ),
      ) as { history?: { defaultStore?: string } };
      expect(config.history?.defaultStore).toBe("repo");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  test("gate runs paid-launch storage parity checks", async () => {
    const tempDir = await makeTempDir();

    try {
      const labRoot = path.join(tempDir, "lab");
      const repoRoot = process.cwd();

      const result = await runGate({ repoRoot, root: labRoot });
      const paths = createLabPaths({ root: labRoot });
      const report = await readFile(
        path.join(paths.reportDir, "index.html"),
        "utf8",
      );
      const gateJson = await readFile(
        path.join(paths.reportDir, "gate-results.json"),
        "utf8",
      );

      expect(result.passed).toBe(true);
      expect(result.checks.some((check) => check.status === "manual")).toBe(
        true,
      );
      expect(result.checks.filter((check) => check.status === "fail")).toEqual(
        [],
      );
      expect(report).toContain("Launch Gate");
      expect(report).toContain("Ready for paid-launch review");
      expect(gateJson).toContain("real app visual confirmation");
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

const writeRepoFixture = async (repoRoot: string): Promise<void> => {
  await mkdir(path.join(repoRoot, "src"), { recursive: true });
  await mkdir(path.join(repoRoot, ".poko", "native"), { recursive: true });
  await mkdir(path.join(repoRoot, ".git"), { recursive: true });
  await mkdir(path.join(repoRoot, "lab", ".state"), { recursive: true });
  await mkdir(path.join(repoRoot, "node_modules"), { recursive: true });

  await writeFile(
    path.join(repoRoot, "src", "index.ts"),
    "export {};\n",
    "utf8",
  );
  await writeFile(
    path.join(repoRoot, ".poko", "poko.json"),
    JSON.stringify({ schemaVersion: 1 }),
    "utf8",
  );
  await writeFile(
    path.join(repoRoot, ".poko", "native", "payload.json"),
    "{}",
    "utf8",
  );
  await writeFile(path.join(repoRoot, ".git", "HEAD"), "ref: main\n", "utf8");
  await writeFile(
    path.join(repoRoot, "lab", ".state", "token.txt"),
    "secret",
    "utf8",
  );
  await writeFile(path.join(repoRoot, "node_modules", "pkg.js"), "", "utf8");
  await writeFile(path.join(repoRoot, "AGENTS.md"), "generated\n", "utf8");
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};
