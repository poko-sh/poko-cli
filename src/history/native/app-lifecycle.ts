import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentId } from "../../adapters/types.ts";
import type { Logger } from "../../core/logger.ts";
import { pollUntil, waitForAgentsReady } from "../readiness.ts";

export type NativeAppLifecycle = {
  appName?: string;
  wasRunning: boolean;
  closed: boolean;
  reopened: boolean;
  safeToWrite: boolean;
  reason?: string;
};

export type NativeAppController = {
  platform: NodeJS.Platform;
  appNames: string[];
  isRunning(appName: string): Promise<boolean>;
  quit(appName: string): Promise<void>;
  open(appName: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
  closeTimeoutMs?: number;
};

type NativeAppLifecycleOptions = {
  displayName: string;
  appNames: string[];
  skipEnvVar: string;
  appController?: NativeAppController;
  logger?: Pick<Logger, "info" | "warn">;
  closeTimeoutMs?: number;
  databaseReadyTimeoutMs?: number;
  readinessAgent?: AgentId;
  projectRoot?: string;
};

const execFileAsync = promisify(execFile);

export const closeAppForNativeSync = async (
  options: NativeAppLifecycleOptions,
): Promise<NativeAppLifecycle> => {
  if (process.env[options.skipEnvVar] === "1") {
    return testLifecycle();
  }

  const controller =
    options.appController ??
    createMacAppController(options.appNames, options.closeTimeoutMs);

  if (controller.platform !== "darwin") {
    options.logger?.warn(
      `${options.displayName} auto-close is only supported on macOS right now; close it manually before native chat sync.`,
    );
    return confirmDatabaseReady(options, controller);
  }

  const appName = await findRunningApp(controller);

  if (!appName) {
    return confirmDatabaseReady(options, controller);
  }

  options.logger?.warn(
    `Poko needs to close ${options.displayName} to sync your data. It will reopen it when finished.`,
  );
  options.logger?.info(`Asking ${appName} to quit.`);

  try {
    await controller.quit(appName);
  } catch (error) {
    return {
      appName,
      wasRunning: true,
      closed: false,
      reopened: false,
      safeToWrite: false,
      reason: `${options.displayName} could not be closed automatically: ${errorMessage(error)}`,
    };
  }

  options.logger?.info(`Waiting for ${options.displayName} to finish closing.`);

  const closed = await waitForAppState(
    controller,
    appName,
    false,
    options.closeTimeoutMs,
  );

  if (!closed) {
    return {
      appName,
      wasRunning: true,
      closed: false,
      reopened: false,
      safeToWrite: false,
      reason: `${options.displayName} did not close in time; native chat sync was skipped so the live database was not edited. Quit ${options.displayName} manually with Cmd+Q, then run sync again.`,
    };
  }

  const databaseReady = await waitForDatabaseReady(options, controller);

  if (!databaseReady.ready) {
    return {
      appName,
      wasRunning: true,
      closed: true,
      reopened: false,
      safeToWrite: false,
      reason: databaseReady.reason,
    };
  }

  options.logger?.info(
    `${options.displayName} is closed. Syncing native history now.`,
  );

  return {
    appName,
    wasRunning: true,
    closed: true,
    reopened: false,
    safeToWrite: true,
  };
};

export const reopenAppAfterNativeSync = async (
  options: NativeAppLifecycleOptions,
  lifecycle: NativeAppLifecycle,
): Promise<void> => {
  if (!lifecycle.wasRunning || !lifecycle.closed || !lifecycle.appName) {
    return;
  }

  const controller =
    options.appController ??
    createMacAppController(options.appNames, options.closeTimeoutMs);

  options.logger?.info(`Reopening ${options.displayName}.`);

  try {
    await controller.open(lifecycle.appName);
    const reopened = await waitForAppState(
      controller,
      lifecycle.appName,
      true,
      5000,
    );

    lifecycle.reopened = reopened;

    if (!reopened) {
      options.logger?.warn(
        `${options.displayName} did not report as reopened yet; you may need to open it manually.`,
      );
    }
  } catch (error) {
    options.logger?.warn(
      `${options.displayName} history sync finished, but reopening failed: ${errorMessage(error)}`,
    );
  }
};

const testLifecycle = (): NativeAppLifecycle => ({
  wasRunning: false,
  closed: false,
  reopened: false,
  safeToWrite: true,
});

const confirmDatabaseReady = async (
  options: NativeAppLifecycleOptions,
  controller: NativeAppController,
): Promise<NativeAppLifecycle> => {
  const databaseReady = await waitForDatabaseReady(options, controller);

  if (!databaseReady.ready) {
    return {
      wasRunning: false,
      closed: false,
      reopened: false,
      safeToWrite: false,
      reason: databaseReady.reason,
    };
  }

  return {
    wasRunning: false,
    closed: false,
    reopened: false,
    safeToWrite: true,
  };
};

const waitForDatabaseReady = async (
  options: NativeAppLifecycleOptions,
  controller: NativeAppController,
): Promise<{ ready: boolean; reason?: string }> => {
  if (!options.readinessAgent || !options.projectRoot) {
    return { ready: true };
  }

  options.logger?.info(
    `Waiting for ${options.displayName} databases to become readable.`,
  );

  const agents = await waitForAgentsReady({
    agents: [options.readinessAgent],
    projectRoot: options.projectRoot,
    timeoutMs: options.databaseReadyTimeoutMs ?? 30000,
    wait: controller.wait,
  });
  const agent = agents[0];

  if (agent?.ready) {
    return { ready: true };
  }

  return {
    ready: false,
    reason:
      agent?.reason ??
      `${options.displayName} database is still locked; native chat sync was skipped. Close ${options.displayName} and wait a few seconds, then run sync again.`,
  };
};

const createMacAppController = (
  appNames: string[],
  closeTimeoutMs = 60000,
): NativeAppController => ({
  platform: process.platform,
  appNames,
  isRunning: isMacAppRunning,
  quit: quitMacApp,
  open: openMacApp,
  wait: sleep,
  closeTimeoutMs,
});

const findRunningApp = async (
  controller: NativeAppController,
): Promise<string | undefined> => {
  for (const appName of controller.appNames) {
    if (await controller.isRunning(appName)) {
      return appName;
    }
  }

  return undefined;
};

const waitForAppState = async (
  controller: NativeAppController,
  appName: string,
  expectedRunning: boolean,
  timeoutMs = controller.closeTimeoutMs ?? 60000,
): Promise<boolean> =>
  pollUntil(
    async () => (await controller.isRunning(appName)) === expectedRunning,
    {
      timeoutMs,
      wait: controller.wait,
    },
  );

const isMacAppRunning = async (appName: string): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      `application ${appleScriptString(appName)} is running`,
    ]);

    return stdout.trim() === "true";
  } catch {
    return false;
  }
};

const quitMacApp = async (appName: string): Promise<void> => {
  await execFileAsync("osascript", [
    "-e",
    `tell application ${appleScriptString(appName)} to quit`,
  ]);
};

const openMacApp = async (appName: string): Promise<void> => {
  await execFileAsync("open", ["-a", appName]);
};

const appleScriptString = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
