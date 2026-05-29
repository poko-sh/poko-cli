# poko

Your pocket context buddy for AI coding agents.

Poko keeps one canonical `.poko/` folder in your project and syncs it into the files different coding agents expect: `CLAUDE.md`, Cursor rules, `AGENTS.md`, `GEMINI.md`, Aider conventions, and local MCP configs.

It can also capture local chat/session history from coding agents into a portable Poko history store, then render handoffs for whichever agent you are switching to next.

## Quick Start

```sh
bun install
bun src/cli.ts init
# add .poko/rules.md, .poko/mcp.json, or other source context when you need it
bun src/cli.ts sync --all
```

## Commands

```sh
poko init [--yes] [--force]
poko sync [--all] [--agent <agent>] [--dry-run]
poko export <agent> [--stdout] [--dry-run]
poko capture [agent|--all] [--store local|repo|both] [--dry-run]
poko history [--store local|repo|both]
poko handoff <agent> [--stdout] [--raw] [--limit 5]
```

Supported agents:

- `claude`
- `cursor`
- `aider`
- `antigravity`
- `copilot`
- `t3code`
- `opencode`
- `gemini`
- `codex`

Useful aliases:

- `agy`, `ag`, `google` -> `antigravity`
- `vscode`, `github-copilot` -> `copilot`
- `t3`, `t3-code` -> `t3code`
- `oc`, `open-code` -> `opencode`

## Canonical Project Context

```text
.poko/
  poko.json
  rules.md       optional
  memory.md      optional
  style.md       optional
  stack.md       optional
  mcp.json       optional
  skills/        optional
```

`poko init` only creates `.poko/poko.json`. Add the optional files yourself
when you actually have context to sync. Missing files mean Poko has nothing to
export for that context type.

This repository commits `.poko/` as the source of truth and ignores generated
agent outputs such as `CLAUDE.md`, `AGENTS.md`, `.cursor/`, and `opencode.json`.
Other projects can choose to commit those generated files if that is useful for
their team.

By default, `--all` syncs every adapter enabled in `.poko/poko.json`. Gemini CLI is kept as a disabled legacy adapter; use `poko sync --agent gemini` if you still need it.

Project sync also captures project-scoped chat/session history from enabled local importers and syncs it into native agent history when that target supports it. Native chat sync currently supports Claude Code, Cursor, T3 Code, OpenCode, and Codex. Cursor and T3 Code write to local SQLite state, so on macOS Poko warns that it needs to close the app, asks it to quit, waits until it is closed, performs the sync, then reopens it. Use `poko sync --no-history` when you only want static context files.

## History Capture

Poko can capture raw project history from:

- Codex: `~/.codex/sessions/**/*.jsonl`
- Claude Code: `~/.claude/projects/<project>/*.jsonl`
- Cursor: workspace `state.vscdb` plus global composer/bubble history

History storage is configurable:

- `local`: `~/.poko/history/projects/<poko-project-id>/`
- `repo`: `.poko/history/`
- `both`: writes both stores

The default is `local` so raw chats do not land in git by accident. `.poko/history/`, `.poko/handoffs/`, and `.poko/native/` are ignored by default. Poko records a project id and creation timestamp in `.poko/poko.json`; by default `poko capture` skips older same-path sessions from before this `.poko` project was initialized. Use `--include-previous` when you intentionally want those old sessions too. `poko handoff` remains a portable fallback, not native chat sync.

```sh
poko capture --all
poko capture codex --store repo
poko capture codex --dry-run --include-previous
poko history
poko handoff cursor --stdout
poko handoff claude --raw --limit 3
```

## Agent Outputs

- Claude Code: `CLAUDE.md`, `.mcp.json`, `.claude/skills/*/SKILL.md`
- Cursor: `.cursor/rules/poko.mdc`, `.cursor/mcp.json`
- Aider: `CONVENTIONS.md`, `.aider.conf.yml`
- Antigravity: `GEMINI.md`, `.agents/rules/poko.md`
- GitHub Copilot / VS Code: `.github/copilot-instructions.md`, `.vscode/mcp.json`
- T3 Code: `AGENTS.md`, `.agents/skills/*/SKILL.md`
- OpenCode: `AGENTS.md`, `opencode.json`
- Gemini CLI legacy: `GEMINI.md`, `.gemini/settings.json`
- Codex: `AGENTS.md`, `.codex/config.toml`

## Development

```sh
bun install
bun test
bun run typecheck
bun run check
bun run build
```

Standalone binaries can be added later with:

```sh
bun run compile
```

## Open Core

Local `init`, `sync`, `export`, `capture`, `history`, and `handoff` are free forever. Pro features such as always-on background capture, cloud sync, AI translation, analytics, marketplace, memory server, and teams are isolated behind a simple license gate for future work.
