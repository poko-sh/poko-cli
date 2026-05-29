import type {
  McpServer,
  PokoContext,
  PokoSections,
  PokoSkill,
} from "./config.ts";

export const renderFullContext = (
  context: PokoContext,
  title = "Poko Context",
): string => {
  if (!hasAnyContext(context)) {
    return "";
  }

  const parts = [
    `# ${title}`,
    "Generated from `.poko/`. Edit `.poko/`, then run `poko sync`.",
    renderSection("Project Rules", context.sections.rules),
    renderSection("Project Memory", context.sections.memory),
    renderSection("Coding Style", context.sections.style),
    renderSection("Tech Stack", context.sections.stack),
    renderMcpSummary(context.mcpServers),
    renderSkillsSummary(context.skills),
  ].filter(Boolean);

  return `${parts.join("\n\n").trim()}\n`;
};

export const renderConventions = (context: PokoContext): string => {
  const sections = [
    renderSection("Project Rules", context.sections.rules),
    renderSection("Coding Style", context.sections.style),
    renderSection("Tech Stack", context.sections.stack),
    renderSection("Project Memory", context.sections.memory),
  ].filter(Boolean);

  if (sections.length === 0) {
    return "";
  }

  const parts = ["# Poko Conventions", ...sections];

  return `${parts.join("\n\n").trim()}\n`;
};

export const hasProjectContext = (context: PokoContext): boolean =>
  Object.values(context.sections).some((section) =>
    Boolean(stripTemplateComments(stripFirstHeading(section))),
  ) || context.skills.length > 0;

const hasAnyContext = (context: PokoContext): boolean =>
  hasProjectContext(context) || Object.keys(context.mcpServers).length > 0;

export const renderSkillForClaude = (skill: PokoSkill): string => {
  if (skill.content.startsWith("---")) {
    return `${skill.content.trim()}\n`;
  }

  return `---
name: ${skill.slug}
description: ${skill.description}
---

${skill.content.trim()}
`;
};

const renderSection = (
  heading: keyof PokoSections | string,
  content: string,
): string => {
  const body = stripTemplateComments(stripFirstHeading(content));

  if (!body) {
    return "";
  }

  return `## ${heading}\n\n${body}`;
};

const stripFirstHeading = (content: string): string =>
  content.replace(/^#\s+.+\n\n?/, "").trim();

const stripTemplateComments = (content: string): string =>
  content.replace(/<!--[\s\S]*?-->/g, "").trim();

const renderMcpSummary = (servers: Record<string, McpServer>): string => {
  const entries = Object.entries(servers);

  if (entries.length === 0) {
    return "";
  }

  const lines = entries.map(([name, server]) => {
    if (server.url) {
      return `- ${name}: HTTP MCP server at ${server.url}`;
    }

    return `- ${name}: stdio MCP server via \`${[server.command, ...(server.args ?? [])].filter(Boolean).join(" ")}\``;
  });

  return `## MCP Servers\n\n${lines.join("\n")}`;
};

const renderSkillsSummary = (skills: PokoSkill[]): string => {
  if (skills.length === 0) {
    return "";
  }

  const lines = skills.map((skill) => `- ${skill.slug}: ${skill.description}`);
  return `## Skills\n\n${lines.join("\n")}`;
};
