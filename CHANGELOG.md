# Changelog

All notable changes to `@poko.sh/cli` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- GitHub Actions CI (test, typecheck, lint, build, npm pack guard)
- `poko status` for everyday project readiness checks
- `poko restore` for cloud/desktop session restore flows
- `poko agents wait-ready` for SQLite write coordination
- Lab gate for storage-level native sync parity checks
- CONTRIBUTING, SECURITY, and issue templates

### Changed

- Package renamed to `@poko.sh/cli` (executable name remains `poko`)
- npm `files` field ships `dist/cli.js` only, not compiled sidecars

## [0.1.0] - 2026-05-28

### Added

- `poko init`, `sync`, `export`, `capture`, `history`, `doctor`, `handoff`
- Static context sync for Claude, Cursor, T3 Code, OpenCode, Pi, Hermes, OpenClaw, Codex
- Native chat history capture and cross-agent sync
- History compatibility reporting and portable handoffs
- Reversible lab harness for adapter validation

[Unreleased]: https://github.com/poko-sh/poko-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/poko-sh/poko-cli/releases/tag/v0.1.0
