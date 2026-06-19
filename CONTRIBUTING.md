# Contributing to Poko

Thanks for helping improve Poko. This project is the open-source CLI that syncs
project context and native chat history across AI coding agents.

## Development setup

Requirements: [Bun](https://bun.sh) >= 1.2.0.

```sh
git clone https://github.com/poko-sh/poko-cli.git
cd poko-cli
bun install
bun src/cli.ts init
```

## Commands to run before opening a PR

```sh
bun test
bun run typecheck
bun run check
bun run build
```

CI runs the same checks on every push and pull request to `main`.

## Project layout

- `src/adapters/` — per-agent static context exporters
- `src/commands/` — CLI command handlers
- `src/history/` — capture, storage, and native sync engines
- `src/core/` — config, detection, file writer
- `tests/` — unit and integration tests
- `lab/` — reversible harness for native history sync validation

## Testing native history sync

Use the lab harness instead of your real agent homes:

```sh
bun run lab:reset
bun run lab:smoke
bun run lab:gate
```

See `lab/README.md` for seeded scenarios, Docker, and the noVNC GUI lane.

## Pull requests

- Keep changes focused; match existing naming and module boundaries.
- Add or update tests for behavior changes.
- Update README or `docs/` when CLI flags, compatibility, or install paths change.
- Do not commit generated agent outputs (`CLAUDE.md`, `.cursor/`, etc.) or local
  history under `.poko/history/`.

## Releases

Maintainers follow `docs/publishing.md`. Do not publish from a dirty working tree.
