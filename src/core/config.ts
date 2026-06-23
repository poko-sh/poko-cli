import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const ClaudeAdapterSchema = z
  .object({
    enabled: z.boolean().default(true),
    mcp: z.boolean().default(true),
    skills: z.boolean().default(true),
  })
  .default({ enabled: true, mcp: true, skills: true });

const CursorAdapterSchema = z
  .object({
    enabled: z.boolean().default(false),
    mcp: z.boolean().default(true),
    legacyCursorrules: z.boolean().default(false),
  })
  .default({ enabled: false, mcp: true, legacyCursorrules: false });

const CoreMcpAdapterSchema = z
  .object({
    enabled: z.boolean().default(true),
    mcp: z.boolean().default(true),
  })
  .default({ enabled: true, mcp: true });

const ExperimentalMcpAdapterSchema = z
  .object({
    enabled: z.boolean().default(false),
    mcp: z.boolean().default(true),
  })
  .default({ enabled: false, mcp: true });

const SkillsAdapterSchema = z
  .object({
    enabled: z.boolean().default(false),
    skills: z.boolean().default(true),
  })
  .default({ enabled: false, skills: true });

const HistorySchema = z
  .object({
    defaultStore: z.enum(["local", "repo", "both"]).default("local"),
    captureRaw: z.boolean().default(true),
    includePreviousProjectIncarnations: z.boolean().default(false),
    syncOnProjectSync: z.boolean().default(true),
    agents: z
      .object({
        codex: z.boolean().default(true),
        claude: z.boolean().default(true),
        cursor: z.boolean().default(false),
        pi: z.boolean().default(false),
        hermes: z.boolean().default(false),
        openclaw: z.boolean().default(false),
      })
      .default({
        codex: true,
        claude: true,
        cursor: false,
        pi: false,
        hermes: false,
        openclaw: false,
      }),
  })
  .default({
    defaultStore: "local",
    captureRaw: true,
    includePreviousProjectIncarnations: false,
    syncOnProjectSync: true,
    agents: {
      codex: true,
      claude: true,
      cursor: false,
      pi: false,
      hermes: false,
      openclaw: false,
    },
  });

const ProjectSchema = z
  .object({
    id: z.string().default(""),
    createdAt: z.string().default(""),
  })
  .default({ id: "", createdAt: "" });

export const PokoConfigSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    project: ProjectSchema,
    adapters: z
      .object({
        claude: ClaudeAdapterSchema,
        cursor: CursorAdapterSchema,
        t3code: SkillsAdapterSchema,
        opencode: ExperimentalMcpAdapterSchema,
        pi: SkillsAdapterSchema,
        hermes: SkillsAdapterSchema,
        openclaw: SkillsAdapterSchema,
        codex: CoreMcpAdapterSchema,
      })
      .default({
        claude: { enabled: true, mcp: true, skills: true },
        cursor: { enabled: false, mcp: true, legacyCursorrules: false },
        t3code: { enabled: false, skills: true },
        opencode: { enabled: false, mcp: true },
        pi: { enabled: false, skills: true },
        hermes: { enabled: false, skills: true },
        openclaw: { enabled: false, skills: true },
        codex: { enabled: true, mcp: true },
      }),
    pro: z
      .object({
        enabledFeatures: z.array(z.string()).default([]),
      })
      .default({ enabledFeatures: [] }),
    history: HistorySchema,
  })
  .default({
    schemaVersion: 1,
    project: {
      id: "",
      createdAt: "",
    },
    adapters: {
      claude: { enabled: true, mcp: true, skills: true },
      cursor: { enabled: false, mcp: true, legacyCursorrules: false },
      t3code: { enabled: false, skills: true },
      opencode: { enabled: false, mcp: true },
      pi: { enabled: false, skills: true },
      hermes: { enabled: false, skills: true },
      openclaw: { enabled: false, skills: true },
      codex: { enabled: true, mcp: true },
    },
    pro: { enabledFeatures: [] },
    history: {
      defaultStore: "local",
      captureRaw: true,
      includePreviousProjectIncarnations: false,
      syncOnProjectSync: true,
      agents: {
        codex: true,
        claude: true,
        cursor: false,
        pi: false,
        hermes: false,
        openclaw: false,
      },
    },
  });

export const McpServerSchema = z
  .object({
    command: z.string().optional(),
    url: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
  })
  .passthrough()
  .superRefine((server, context) => {
    if (!server.command && !server.url) {
      context.addIssue({
        code: "custom",
        message: "Each MCP server needs either command or url.",
      });
    }
  });

export const McpConfigSchema = z
  .object({
    mcpServers: z.record(z.string(), McpServerSchema).default({}),
  })
  .default({ mcpServers: {} });

export type PokoConfig = z.infer<typeof PokoConfigSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;

export type PokoSkill = {
  name: string;
  slug: string;
  description: string;
  content: string;
};

export type PokoSections = {
  rules: string;
  memory: string;
  style: string;
  stack: string;
};

export type PokoContext = {
  root: string;
  pokoDir: string;
  config: PokoConfig;
  sections: PokoSections;
  mcpServers: Record<string, McpServer>;
  skills: PokoSkill[];
  warnings: string[];
};

export const POKO_DIR = ".poko";

export const createDefaultPokoConfig = (): PokoConfig =>
  PokoConfigSchema.parse({});

export const loadPokoContext = async (root: string): Promise<PokoContext> => {
  const absoluteRoot = path.resolve(root);
  const pokoDir = path.join(absoluteRoot, POKO_DIR);
  const configPath = path.join(pokoDir, "poko.json");
  const raw = await readJsonFile(
    configPath,
    "Run `poko init` to create .poko/poko.json.",
  );
  const config = parseWithSchema(PokoConfigSchema, raw, configPath);
  const mcp = await loadMcpConfig(absoluteRoot);
  const sections = {
    rules: await readOptionalText(pokoDir, "rules.md"),
    memory: await readOptionalText(pokoDir, "memory.md"),
    style: await readOptionalText(pokoDir, "style.md"),
    stack: await readOptionalText(pokoDir, "stack.md"),
  };
  const skills = await loadSkills(pokoDir);
  const warnings = [
    ...findMcpWarnings(mcp.mcpServers),
    ...removedAdapterWarnings(raw),
  ];

  return {
    root: absoluteRoot,
    pokoDir,
    config,
    sections,
    mcpServers: mcp.mcpServers,
    skills,
    warnings,
  };
};

export const loadPokoConfig = async (root: string): Promise<PokoConfig> => {
  const configPath = path.join(root, POKO_DIR, "poko.json");
  const raw = await readJsonFile(
    configPath,
    "Run `poko init` to create .poko/poko.json.",
  );
  return parseWithSchema(PokoConfigSchema, raw, configPath);
};

export const removedAdapterWarnings = (raw: unknown): string[] => {
  if (!isRecord(raw) || !isRecord(raw.adapters)) {
    return [];
  }

  const warnings: string[] = [];

  for (const adapter of ["antigravity", "copilot"] as const) {
    if (adapter in raw.adapters) {
      warnings.push(
        `${adapter} is no longer supported and was ignored in .poko/poko.json.`,
      );
    }
  }

  return warnings;
};

export const loadMcpConfig = async (root: string): Promise<McpConfig> => {
  const configPath = path.join(root, POKO_DIR, "mcp.json");

  try {
    const raw = await readJsonFile(configPath);
    return parseWithSchema(McpConfigSchema, raw, configPath);
  } catch (error) {
    if (error instanceof BunFileMissingError) {
      return { mcpServers: {} };
    }

    throw error;
  }
};

const readJsonFile = async (
  filePath: string,
  missingHint?: string,
): Promise<unknown> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new BunFileMissingError(
        `${filePath} does not exist. ${missingHint ?? ""}`.trim(),
      );
    }

    if (error instanceof SyntaxError) {
      throw new Error(`${filePath} is not valid JSON: ${error.message}`);
    }

    throw error;
  }
};

const parseWithSchema = <T>(
  schema: z.ZodType<T>,
  raw: unknown,
  filePath: string,
): T => {
  const result = schema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`${filePath} is not a valid Poko config:\n${details}`);
  }

  return result.data;
};

const readOptionalText = async (
  directory: string,
  fileName: string,
): Promise<string> => {
  try {
    return (await readFile(path.join(directory, fileName), "utf8")).trim();
  } catch (error) {
    if (isMissingFileError(error)) {
      return "";
    }

    throw error;
  }
};

const loadSkills = async (pokoDir: string): Promise<PokoSkill[]> => {
  const skillsDir = path.join(pokoDir, "skills");

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skills: PokoSkill[] = [];

    for (const entry of entries) {
      if (
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        entry.name !== "README.md"
      ) {
        const content = (
          await readFile(path.join(skillsDir, entry.name), "utf8")
        ).trim();
        skills.push(parseSkill(path.basename(entry.name, ".md"), content));
      }

      if (entry.isDirectory()) {
        const skillPath = path.join(skillsDir, entry.name, "SKILL.md");
        if (await fileExists(skillPath)) {
          const content = (await readFile(skillPath, "utf8")).trim();
          skills.push(parseSkill(entry.name, content));
        }
      }
    }

    return skills.sort((left, right) => left.slug.localeCompare(right.slug));
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
};

const parseSkill = (name: string, content: string): PokoSkill => {
  const descriptionMatch = content.match(
    /^---\n[\s\S]*?\ndescription:\s*(.+?)\n[\s\S]*?\n---/,
  );
  const headingMatch = content.match(/^#\s+(.+)$/m);
  const description =
    descriptionMatch?.[1]?.trim() ?? headingMatch?.[1]?.trim() ?? name;

  return {
    name,
    slug: slugify(name),
    description,
    content,
  };
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "skill";

const findMcpWarnings = (servers: Record<string, McpServer>): string[] => {
  const warnings: string[] = [];

  for (const [name, server] of Object.entries(servers)) {
    for (const [fieldName, values] of [
      ["env", server.env],
      ["headers", server.headers],
    ] as const) {
      if (!values) {
        continue;
      }

      for (const [key, value] of Object.entries(values)) {
        if (looksLikeLiteralSecret(value)) {
          warnings.push(
            `.poko/mcp.json has a literal-looking secret at ${name}.${fieldName}.${key}. Prefer an environment reference like \${env:${key}}.`,
          );
        }
      }
    }
  }

  return warnings;
};

const looksLikeLiteralSecret = (value: string): boolean => {
  if (value.includes("$") || value.includes("{env:")) {
    return false;
  }

  return /(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-|AKIA[A-Z0-9]{16}|-----BEGIN|[A-Za-z0-9_-]{40,})/.test(
    value,
  );
};

export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
};

export const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
};

export class BunFileMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BunFileMissingError";
  }
}

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: string }).code === "ENOENT";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
