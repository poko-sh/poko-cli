import { describe, expect, spyOn, test } from "bun:test";
import { closeAppForNativeSync } from "../../src/history/native/app-lifecycle.ts";
import * as readiness from "../../src/history/readiness.ts";

const linuxController = {
  platform: "linux" as const,
  appNames: ["Cursor"],
  async isRunning() {
    return false;
  },
  async quit() {},
  async open() {},
  async wait() {},
};

describe("native app lifecycle", () => {
  test("skips write on non-macOS when database is not ready", async () => {
    const waitSpy = spyOn(readiness, "waitForAgentsReady").mockResolvedValue([
      { id: "cursor", ready: false, reason: "locked" },
    ]);

    const lifecycle = await closeAppForNativeSync({
      displayName: "Cursor",
      appNames: ["Cursor"],
      skipEnvVar: "POKO_CURSOR_SKIP_APP_LIFECYCLE_TEST",
      appController: linuxController,
      readinessAgent: "cursor",
      projectRoot: "/tmp/project",
    });

    expect(lifecycle.safeToWrite).toBe(false);
    expect(lifecycle.reason).toContain("locked");
    expect(waitSpy).toHaveBeenCalled();

    waitSpy.mockRestore();
  });

  test("allows write on non-macOS when database is ready", async () => {
    const waitSpy = spyOn(readiness, "waitForAgentsReady").mockResolvedValue([
      { id: "cursor", ready: true },
    ]);

    const lifecycle = await closeAppForNativeSync({
      displayName: "Cursor",
      appNames: ["Cursor"],
      skipEnvVar: "POKO_CURSOR_SKIP_APP_LIFECYCLE_TEST",
      appController: linuxController,
      readinessAgent: "cursor",
      projectRoot: "/tmp/project",
    });

    expect(lifecycle.safeToWrite).toBe(true);
    expect(lifecycle.reason).toBeUndefined();
    expect(waitSpy).toHaveBeenCalled();

    waitSpy.mockRestore();
  });
});
