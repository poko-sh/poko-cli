# Poko Product Roadmap

## Motto

Same conversation everywhere.

Poko exists to move the actual working thread: messages, project context,
useful tool evidence, files, MCPs, skills, and the native conversation shape the
next agent needs to continue.

## Free CLI

The open-source CLI stays local-first and free forever:

- initialize a project with `.poko/poko.json`
- sync project rules, MCP config, skills, and agent context files
- capture raw project-scoped chat history
- sync native chat history into supported agents
- inspect status, doctor output, dry-runs, diffs, and backups
- render portable handoffs as a fallback
- run the reversible lab for adapter validation

The CLI should avoid background behavior unless the user explicitly asks for it.
It should be boringly inspectable: human-readable files, dry-runs, local
backups, and no cloud requirement.

## Paid App

The paid product can be a GUI/app on top of the same engine. macOS first is the
fastest wedge because most target agents already have strong macOS usage and the
app lifecycle controls are better understood there. Cross-platform support
should remain part of the architecture from day one.

Good paid surfaces:

- always-on sync and background capture
- cloud sync across machines
- account/auth-aware agent setup checks
- visual conversation browser and restore UI
- AI-assisted migration when native formats cannot carry a feature directly
- usage analytics across agents and projects
- premium memory/MCP server
- team/workspace policies
- marketplace for agent skills and context packs

The app should call stable CLI/core APIs instead of duplicating adapter logic.
Auth, cloud state, and license state should live outside project `.poko/`.

## V1 Agent Matrix

Native chat sync focus:

- Codex
- Claude Code
- Cursor
- T3 Code
- OpenCode
- Pi
- Hermes Agent
- OpenClaw

Static/project context only or paused:

- GitHub Copilot / VS Code
- Antigravity

Removed from MVP:

- Aider
- legacy Gemini CLI

## Safety Defaults

- Default history store is local: `~/.poko/history/...`
- Repo history is opt-in.
- Generated native exports and backups are ignored by default.
- Same-agent imports are skipped to avoid echo loops.
- Poko-tagged imports are ignored during capture.
- GUI apps that need exclusive access should be closed, verified closed, synced,
  then reopened.
- `--dry-run --diff` is the trust-building path before touching static files.
- `--backup` protects existing static files before overwrite/merge.

## Release Bar

Before a public v1 release:

- `poko init`, `poko status`, `poko sync`, `poko export`, `poko capture`, and
  `poko history` should have crisp help text.
- The README should show one compelling “same conversation everywhere” demo.
- The lab should prove storage-level parity for every native target.
- At least Codex, Claude Code, Cursor, and one non-big-three agent should have
  visual confirmation in a real app or CLI.
- The project should publish an npm package first, then add Bun compiled
  binaries once install friction is the bigger problem.
