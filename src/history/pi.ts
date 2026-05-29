import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type PiSettings = {
  defaultProvider?: string;
  defaultModel?: string;
  sessionDir?: string;
};

export type PiImportModel = {
  provider: string;
  model: string;
};

const FALLBACK_PI_IMPORT_MODEL: PiImportModel = {
  provider: "poko",
  model: "import",
};

export const resolvePiAgentDir = (): string =>
  process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");

export const encodePiProjectPath = (projectRoot: string): string =>
  `--${path
    .resolve(projectRoot)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;

export const resolvePiSessionDir = async (
  projectRoot: string,
): Promise<string> =>
  (await resolvePiConfiguredSessionDir(projectRoot)) ??
  path.join(resolvePiAgentDir(), "sessions", encodePiProjectPath(projectRoot));

export const resolvePiCandidateSessionDirs = async (
  projectRootCandidates: string[],
): Promise<string[]> => {
  const defaultDirs = projectRootCandidates.map((projectRoot) =>
    path.join(
      resolvePiAgentDir(),
      "sessions",
      encodePiProjectPath(projectRoot),
    ),
  );
  const configuredDir = await resolvePiConfiguredSessionDir(
    projectRootCandidates[0] ?? process.cwd(),
  );

  return unique([...defaultDirs, configuredDir]);
};

export const resolvePiImportModel = async (
  projectRoot: string,
): Promise<PiImportModel> => {
  const envModel = parseProviderModel(process.env.POKO_PI_IMPORT_MODEL);

  if (envModel) {
    return envModel;
  }

  const settings = await loadPiSettings(projectRoot);

  if (settings.defaultProvider && settings.defaultModel) {
    return {
      provider: settings.defaultProvider,
      model: settings.defaultModel,
    };
  }

  return FALLBACK_PI_IMPORT_MODEL;
};

const resolvePiConfiguredSessionDir = async (
  projectRoot: string,
): Promise<string | undefined> => {
  if (process.env.PI_CODING_AGENT_SESSION_DIR) {
    return expandTildePath(process.env.PI_CODING_AGENT_SESSION_DIR);
  }

  const globalSettings = await readPiSettings(
    path.join(resolvePiAgentDir(), "settings.json"),
  );
  const projectSettings = await readPiSettings(
    path.join(projectRoot, ".pi", "settings.json"),
  );

  if (isNonEmptyString(projectSettings.sessionDir)) {
    return resolveSettingPath(
      projectSettings.sessionDir,
      path.join(projectRoot, ".pi"),
    );
  }

  if (isNonEmptyString(globalSettings.sessionDir)) {
    return resolveSettingPath(globalSettings.sessionDir, resolvePiAgentDir());
  }

  return undefined;
};

const loadPiSettings = async (projectRoot: string): Promise<PiSettings> => ({
  ...(await readPiSettings(path.join(resolvePiAgentDir(), "settings.json"))),
  ...(await readPiSettings(path.join(projectRoot, ".pi", "settings.json"))),
});

const readPiSettings = async (settingsPath: string): Promise<PiSettings> => {
  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;

    if (!isRecord(parsed)) {
      return {};
    }

    return {
      defaultProvider: stringValue(parsed.defaultProvider),
      defaultModel: stringValue(parsed.defaultModel),
      sessionDir: stringValue(parsed.sessionDir),
    };
  } catch {
    return {};
  }
};

const parseProviderModel = (
  value: string | undefined,
): PiImportModel | undefined => {
  if (!value) {
    return undefined;
  }

  const [provider, ...modelParts] = value.split("/");
  const model = modelParts.join("/");

  if (!provider || !model) {
    return undefined;
  }

  return { provider, model };
};

const resolveSettingPath = (value: string, baseDir: string): string => {
  const expanded = expandTildePath(value);
  return path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
};

const expandTildePath = (value: string): string => {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unique = <T>(values: Array<T | undefined>): T[] => [
  ...new Set(values.filter((value): value is T => value !== undefined)),
];
