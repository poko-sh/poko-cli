# poko

Your pocket context buddy for AI coding agents.

**Switch between Codex and Claude Code without losing project context.**

Poko keeps one canonical `.poko/` folder in your project and syncs it into the files Codex and Claude Code expect: `AGENTS.md`, `CLAUDE.md`, local MCP configs, and agent skills.

It can also import project chat history into native agent stores. The public alpha focuses on **Codex ↔ Claude Code** because that is the primary full-resume path. Cursor and other adapters remain available, but they are limited or experimental. See [History compatibility](#history-compatibility) below.

## Quick Start

Install from npm (requires [Bun](https://bun.sh) >= 1.2):

```sh
bunx @poko.sh/cli init
# add .poko/rules.md, .poko/mcp.json, or other source context when you need it
bunx @poko.sh/cli doctor
bunx @poko.sh/cli sync --targets codex,claude --dry-run
bunx @poko.sh/cli sync --targets codex,claude
```

Contributors running from source:

```sh
bun install
bun src/cli.ts init
bun src/cli.ts doctor
bun src/cli.ts sync --targets codex,claude --dry-run
bun src/cli.ts sync --targets codex,claude
```

## Demo: same conversation in Codex and Claude Code

This is the primary public alpha path: import Codex history into Claude Code, or Claude Code history into Codex, so you can keep sending messages in the native chat.

```sh
# 1. Initialize Poko in your project
bunx @poko.sh/cli init

# 2. Preview what would sync (no writes)
bunx @poko.sh/cli sync --targets codex,claude --dry-run --json

# 3. Sync static context + Codex/Claude chat history
bunx @poko.sh/cli sync --targets codex,claude

# 4. Open Codex or Claude Code in this project. Imported threads should appear
#    in the native history for the other agent.
```

For Cursor or other agents, check [History compatibility](#history-compatibility)
first. Cross-agent history in Cursor is read-only; use `poko handoff cursor` when
you need a portable fallback.

## Commands

```sh
poko init [--yes] [--force]
poko sync [--all] [--agent <agent>] [--targets a,b] [--dry-run] [--diff] [--backup] [--no-history] [--json]
poko sync --global [--all] [--agent <agent>] [--targets a,b] [--dry-run] [--json]
poko export <agent> [--stdout] [--dry-run] [--diff] [--backup]
poko capture [agent|--all] [--store local|repo|both] [--dry-run] [--json]
poko history [--store local|repo|both] [--json]
poko status [--json]
poko doctor [--json]
poko handoff <agent> [--stdout] [--raw] [--limit 5]
poko restore --file <path> [--targets a,b] [--all] [--dry-run] [--json]
poko agents wait-ready --agents cursor,t3code [--timeout 30000] [--probe] [--json]
```

Add `--private-display` to any command, or set `POKO_PRIVATE_DISPLAY=1`, when
you want CLI output to hide email-like values without changing auth state.

Supported agents:

- Core alpha: `codex`, `claude`
- Limited: `cursor` (readable imports, no cross-agent thread resume)
- Experimental opt-ins: `opencode`, `pi`, `t3code`, `hermes`, `openclaw`

Useful aliases:

- `t3`, `t3-code` -> `t3code`
- `oc`, `open-code` -> `opencode`
- `pi-coding-agent` -> `pi`
- `hermes-agent` -> `hermes`
- `claw`, `clawdbot`, `open-claw` -> `openclaw`

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

By default, new projects enable Codex and Claude Code. `--all` syncs every adapter enabled in `.poko/poko.json`, so public alpha projects use the Codex/Claude route unless you opt into more adapters.

Project sync also captures project-scoped chat/session history from enabled local importers and syncs it into native agent history when that target supports it. **Codex ↔ Claude Code is the primary full-resume path.** Cursor imports cross-agent history for reading and creates a separate `Continue:` chat; it cannot resume another agent's thread inside the imported composer. Cursor and T3 Code write to local SQLite state, so on macOS Poko warns that it needs to close the app, asks it to quit, waits until it is closed, performs the sync, then reopens it. Use `poko sync --no-history` when you only want static context files.

Use `--targets codex,claude` for the public alpha path. Use explicit targets such as `--targets cursor` or `--targets opencode` when you intentionally want to test limited or experimental adapters. For project sync, selected targets receive any supported static context plus native chat history. For global sync and restore, selected targets are filtered to native-history-capable agents.

`poko sync --dry-run` prints the specific project sessions it would include, each native target location, and target-specific details such as stale imports removed, files written, import commands run, and same-agent sessions skipped.

## What Poko Will Not Promise Yet

- It will not promise every agent can resume every imported thread.
- It will not treat Cursor as a full native resume target; Cursor imports are readable history plus a `Continue:` chat.
- It will not make experimental adapters part of the public alpha support promise.
- It will not write native history without showing dry-run details and target-specific warnings.

Global sync is explicit because it can touch native history for every local
project Poko can discover:

```sh
poko sync --global --all --dry-run --json
poko sync --global --agent claude
```

`poko sync --global` does not write static project files. It scans supported
local history stores, groups conversations by their recorded project root, and
syncs those sessions into native target history. The JSON report includes
`mode: "global"`, a `global.projects` summary, captured agent counts, and
per-project native target results so the desktop app can preview the operation
before a write.

Cloud restore uses the same local sync engine. A future desktop app or cloud
consumer can download raw Poko session payloads into a temporary JSON file, then
run:

```sh
poko restore --file /path/to/sessions.json --targets codex,claude
```

`poko restore` writes the sessions back into the configured local history store
and imports them into the selected native agent targets. It accepts either a
single `session` or a `sessions` array in Poko raw-session format.

Use `poko sync --dry-run --diff` when you want to preview static file edits line by line. Use `poko sync --backup` or `poko export <agent> --backup` when overwriting existing static files; backups are written under `.poko/backups/` and ignored by default.

## History Capture

Poko can capture raw project history from:

- Codex: `~/.codex/sessions/**/*.jsonl`
- Claude Code: `~/.claude/projects/<project>/*.jsonl`
- Cursor: workspace `state.vscdb` plus global composer/bubble history
- Pi: `~/.pi/agent/sessions/<project>/*.jsonl`
- Hermes Agent: `~/.hermes/state.db`
- OpenClaw: `~/.openclaw/agents/<agent>/sessions/*.jsonl`

History storage is configurable:

- `local`: `~/.poko/history/projects/<poko-project-id>/`
- `repo`: `.poko/history/`
- `both`: writes both stores

The default is `local` so raw chats do not land in git by accident. `.poko/history/`, `.poko/handoffs/`, and `.poko/native/` are ignored by default. Poko records a project id and creation timestamp in `.poko/poko.json`; by default `poko capture` skips older same-path sessions from before this `.poko` project was initialized. Use `--include-previous` when you intentionally want those old sessions too. `poko handoff` remains a portable fallback when native resume is unavailable.

## History Compatibility

Poko syncs **static project context** (rules, MCP, skills) to every supported adapter. **Native chat sync** varies by agent.


| Agent        | Alpha stage  | Static context | History import | Resume imported thread | Notes                                                                      |
| ------------ | ------------ | -------------- | -------------- | ---------------------- | -------------------------------------------------------------------------- |
| Claude Code  | Core         | Yes            | Yes            | Yes                    | Primary target for Codex history                                           |
| Codex        | Core         | Yes            | Yes            | Yes                    | Primary source/target for native chat                                      |
| Cursor       | Limited      | Yes            | Partial        | No                     | Read-only `[History]` archive + `Continue:` chat (8 recent messages); macOS app close required |
| T3 Code      | Experimental | Yes            | Yes            | Yes                    | macOS app close required                                                   |
| OpenCode     | Experimental | Yes            | Yes            | Partial                | Uses `opencode import`; app may need refresh                               |
| Pi           | Experimental | Yes            | Yes            | Yes                    | JSONL session files                                                        |
| Hermes Agent | Experimental | Yes            | Yes            | Partial                | SQLite session writes                                                      |
| OpenClaw     | Experimental | Yes            | Yes            | Partial                | Session JSONL writes                                                       |


**Resume imported thread** means you can send new messages and continue the conversation inside that native chat. Cursor cannot do this for cross-agent imports because it requires a Cursor server session token that Poko cannot create from Codex/Claude history. Poko creates a separate `Continue:` chat with up to 8 recent messages instead.

Recommended routes:

- **Codex ↔ Claude Code** — full native chat sync and resume
- **Anything → Cursor** — limited static context + readable history + `Continue:` chat for new work
- **Experimental adapters** — opt in from `.poko/poko.json` when you want to test them
- **`poko handoff <agent>`** — portable markdown when native resume is not available

CLI and app consumers can read the machine-readable table from `poko doctor --json` (`historyCompatibility`) or `poko sync --json` (`historyCompatibility`, plus route-specific `warnings`).

```sh
poko capture --all
poko capture codex --store repo
poko capture codex --dry-run --include-previous
poko history
poko handoff cursor --stdout
poko handoff claude --raw --limit 3
```

## Status And Doctor

`poko status` is the everyday readiness check. It summarizes source context, enabled/detected adapters, and stored history index counts without capturing live agent history or running native dry-run writes:

```sh
poko status
poko status --json
```

Future app and automation consumers should use the JSON protocol instead of
parsing terminal output: `poko status --json`, `poko doctor --json`,
`poko sync --json`, `poko capture --json`, and `poko history --json`. See
`docs/protocol.md`.

`poko doctor` is the deeper inspection path. It captures live project history, runs native sync dry-runs, and reports route-specific warnings. It reports:

- project id, creation time, and history store
- source context files that are present, empty, or missing
- adapter enablement and detection signals
- captured current/skipped project history counts
- native sync dry-run locations and per-target details
- MCP/security warnings

```sh
poko doctor
```

## Agent Outputs

- Claude Code: `CLAUDE.md`, `.mcp.json`, `.claude/skills/*/SKILL.md`
- Cursor: `.cursor/rules/poko.mdc`, `.cursor/mcp.json`
- T3 Code: `AGENTS.md`, `.agents/skills/*/SKILL.md`
- OpenCode: `AGENTS.md`, `opencode.json`
- Pi: `AGENTS.md`, `.pi/skills/*/SKILL.md`
- Hermes Agent: `AGENTS.md`, `.agents/skills/*/SKILL.md`
- OpenClaw: `AGENTS.md`, `.agents/skills/*/SKILL.md`
- Codex: `AGENTS.md`, `.codex/config.toml`

## Development

```sh
bun install
bun test
bun run typecheck
bun run check
bun run build
```

Use the reversible lab harness when testing native history sync against isolated
agent homes:

```sh
bun run lab:reset
bun run lab:smoke
bun run lab:scenario -- all-to-all --write
```

The lab keeps disposable run state under `~/.poko/lab` and preserves signed-in
baselines unless you explicitly run `bun lab/poko-lab.ts reset --include-auth --yes`. When noVNC sign-in is flaky, `bun lab/poko-lab.ts import-auth` can copy
selected local auth/profile state into that lab-only baseline. See
`lab/README.md` for seeded scenarios, the Docker flow, and the noVNC GUI lane.

Standalone binaries can be added later with:

```sh
bun run compile
```

Tauri sidecar binaries for a future desktop app can be built with:

```sh
bun run compile:darwin-arm64
bun run compile:darwin-x64
bun run compile:linux-x64
bun run compile:windows-x64
```

## OpenCore

Local `init`, `sync`, `export`, `capture`, `history`, and `handoff` are free forever. The open-source CLI stays local-first.
