import { describe, expect, spyOn, test } from "bun:test";
import { runAgentsWaitReady } from "../../src/commands/agents-wait-ready.ts";
import * as readiness from "../../src/history/readiness.ts";

describe("poko agents wait-ready", () => {
  test("empty agents list is not ready", async () => {
    const report = await runAgentsWaitReady({
      cwd: process.cwd(),
      agents: "",
      wait: true,
    });

    expect(report.ready).toBe(false);
    expect(report.agents).toEqual([]);
  });

  test("empty agents probe is not ready", async () => {
    const report = await runAgentsWaitReady({
      cwd: process.cwd(),
      agents: "",
      wait: false,
    });

    expect(report.ready).toBe(false);
    expect(report.agents).toEqual([]);
  });

  test("wait mode calls waitForAgentsReady", async () => {
    const waitSpy = spyOn(readiness, "waitForAgentsReady").mockResolvedValue([
      { id: "cursor", ready: true },
    ]);
    const probeSpy = spyOn(readiness, "probeAgents");

    const report = await runAgentsWaitReady({
      cwd: "/tmp/project",
      agents: "cursor",
      wait: true,
    });

    expect(report.ready).toBe(true);
    expect(report.agents).toEqual([{ id: "cursor", ready: true }]);
    expect(waitSpy).toHaveBeenCalledTimes(1);
    expect(probeSpy).not.toHaveBeenCalled();

    waitSpy.mockRestore();
    probeSpy.mockRestore();
  });

  test("probe mode calls probeAgents once", async () => {
    const probeSpy = spyOn(readiness, "probeAgents").mockResolvedValue([
      { id: "t3code", ready: false, reason: "locked" },
    ]);
    const waitSpy = spyOn(readiness, "waitForAgentsReady");

    const report = await runAgentsWaitReady({
      cwd: "/tmp/project",
      agents: "t3code",
      wait: false,
    });

    expect(report.ready).toBe(false);
    expect(report.agents).toEqual([
      { id: "t3code", ready: false, reason: "locked" },
    ]);
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(waitSpy).not.toHaveBeenCalled();

    probeSpy.mockRestore();
    waitSpy.mockRestore();
  });

  test("skips unknown agents in the agents list", async () => {
    const probeSpy = spyOn(readiness, "probeAgents").mockResolvedValue([]);

    const report = await runAgentsWaitReady({
      cwd: "/tmp/project",
      agents: "unknown-agent",
      wait: false,
    });

    expect(report.ready).toBe(false);
    expect(report.agents).toEqual([]);
    expect(probeSpy).not.toHaveBeenCalled();

    probeSpy.mockRestore();
  });
});
