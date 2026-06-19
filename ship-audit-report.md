# Shippability Assessment: Poko CLI

**Date:** 2026-06-19  
**Scope:** `/Users/fraser/Documents/Development/poko`, branch `main`, version `0.1.0` (61 uncommitted file changes)  
**Release surface:** npm (`@poko-sh/cli` planned), GitHub Releases (compiled sidecars), future Homebrew tap  
**Stated v1 goal:** Local-first free CLI that syncs project context and native chat history across AI coding agents; npm-first public release per `docs/product-roadmap.md` and `docs/publishing.md`

## Verdict: HOLD

**Total score: 65/100**

| # | Dimension | Score | One-line summary |
|---|-----------|------:|------------------|
| 1 | Feature completeness | 7/10 | Core CLI and 8-agent matrix are implemented; roadmap release-bar items (demo, npm publish, full lab parity) remain open |
| 2 | Code quality & architecture | 7/10 | Clear module boundaries and conventions; biome check fails; a few large hotspot files |
| 3 | Test coverage & stability | 8/10 | 100 tests pass locally across adapters, sync, capture, and lab gate; no CI enforcement |
| 4 | Security posture | 7/10 | Local-first with sane defaults and redaction; small dep tree; no automated audit pipeline |
| 5 | Build, CI & release pipeline | 3/10 | Build/tests pass locally but no CI, no npm publish, packaging would ship 58MB sidecar |
| 6 | Documentation & onboarding | 7/10 | Strong README and `docs/`; quick start is dev-only; missing end-to-end demo and CONTRIBUTING |
| 7 | UX & product polish | 8/10 | Crisp help, structured status/doctor output, JSON protocol, clear capability warnings |
| 8 | Configuration & environments | 7/10 | `.poko/` config model is clear; Bun engine documented; publish/install path not wired |
| 9 | Legal, licensing & compliance | 7/10 | MIT LICENSE present; local CLI needs no privacy policy; scoped npm rename still pending |
| 10 | Operational readiness | 4/10 | Public GitHub repo exists; no issue templates, CONTRIBUTING, CHANGELOG, CI, or support docs |

## Executive summary

Poko is a capable, well-tested local CLI with strong adapter coverage, thoughtful UX (dry-run, backups, compatibility warnings), and a meaningful lab gate. A stranger cannot yet install and use it through the documented public channel: `@poko-sh/cli` is not on npm, there is no CI, and `bun run check` fails. The working tree also has substantial uncommitted changes on `main`, which is risky for tagging a public release.

The product is close on features and polish but not on release infrastructure. Recommend holding public v1 until npm publish automation, CI, packaging fixes, and the roadmap's release-bar checklist are complete. Beta labeling (`0.1.0`) is appropriate if you ship early to early adopters with explicit "install from source" instructions.

## Detailed findings

### 1. Feature completeness (7/10)
**Evidence:** README lists 8 supported agents and 10+ commands; `poko doctor` detected all 8 adapters on this machine; `tests/commands/sync.test.ts` covers cross-agent native sync for Codex, Claude, Cursor, T3 Code, OpenCode, Pi, Hermes, and OpenClaw; lab gate test reports `23 pass, 1 manual, 0 fail`; `docs/product-roadmap.md` defines the v1 agent matrix and release bar.

**Gaps:** Roadmap release bar requires (a) a compelling "same conversation everywhere" demo in README — none found (no demo/walkthrough/example sections); (b) npm-first publish — `@poko-sh/cli` returns 404 on npm; (c) lab storage-level parity for every native target — 1 manual check remains; (d) `poko agents wait-ready` exists in CLI/protocol but is absent from README command list; 61 uncommitted files on `main` suggest release snapshot is not settled.

### 2. Code quality & architecture (7/10)
**Evidence:** Clear layout: `src/adapters/`, `src/commands/`, `src/history/` (importers + native sync), `src/core/`; adapter pattern with shared types; no `TODO`/`FIXME` in `src/`; TypeScript strict check passes; largest files: `cursor-render.ts` (~1009 lines), `sync.ts` (~678), `t3code.ts` (~763).

**Gaps:** `bun run check` exits 1 with 24 biome errors (formatting, unused imports, import organization) across `lab/`, `src/commands/`, and eval artifacts under `.poko/v1-ship-audit-eval/`; hotspot files exceed typical maintainability thresholds; substantial in-flight refactor visible in git status (deleted adapters, new cursor modules).

### 3. Test coverage & stability (8/10)
**Evidence:** `bun test` — **100 pass, 0 fail**, 413 assertions, 18 test files; coverage spans writer, detection, all adapters, history capture (6 importers), native sync (including Cursor backup and app lifecycle), restore, doctor/status, CLI help/errors, and lab gate; lab gate integration test runs paid-launch storage parity checks.

**Gaps:** No CI workflow to enforce tests on push/PR; no coverage report or threshold; integration tests rely on temp dirs and mocked agent homes — real-agent visual confirmation is manual per lab gate; tests not run against published npm artifact.

### 4. Security posture (7/10)
**Evidence:** Local-first OSS — no cloud auth or telemetry in free CLI (`src/core/license.ts` gates Pro features only); `POKO_PRIVATE_DISPLAY` and `redactPersonalInfo` hide email-like values; doctor reports MCP/security warnings; grep for hardcoded secrets found only `looksLikeLiteralSecret` helper in `config.ts`; only 3 runtime deps (`zod`, `picocolors`, `@iarna/toml`); Cursor sync backs up SQLite before writes.

**Gaps:** No automated dependency audit in CI (`bun audit`/`npm audit` not wired; `npm audit` needs lockfile); CLI writes to agent SQLite stores (inherent blast radius — mitigated by backups/dry-run but not sandboxed); `npm pack --dry-run` would publish whatever is in `dist/` including compiled binaries.

### 5. Build, CI & release pipeline (3/10)
**Evidence:** `bun run build` succeeds (bundles `dist/cli.js` 0.9 MB); `bun run typecheck` passes; `docs/publishing.md` documents scoped npm name, release checklist, and GitHub Actions intent; `package.json` has `compile:*` sidecar targets; repo is public at `https://github.com/poko-sh/poko-cli`.

**Gaps:** **No `.github/workflows/`** — zero CI; `gh run list` returns nothing; `@poko-sh/cli` not published; `package.json` name is still `poko` not `@poko-sh/cli`; release checklist step `bun run check` currently fails; `npm pack --dry-run` produces a **59.4 MB** tarball because `dist/sidecars/poko-aarch64-apple-darwin` (58.5 MB) is included under `"files": ["dist", ...]`; no CHANGELOG or tagged release process executed; 61 uncommitted changes on `main`.

### 6. Documentation & onboarding (7/10)
**Evidence:** README is comprehensive: quick start, all major commands, history compatibility matrix, agent outputs, development/lab instructions; `docs/protocol.md` for JSON consumers; `docs/native-chat-sync.md`, `docs/publishing.md`, `docs/product-roadmap.md`; per-command help is crisp (`poko sync --help`, `poko capture --help`); `lab/README.md` documents reset, smoke, gate, and Docker flows.

**Gaps:** Quick start uses `bun src/cli.ts` (contributor path), not `bunx @poko-sh/cli` (stranger path); no CONTRIBUTING.md; roadmap release bar explicitly calls for a compelling demo — not present; `agents wait-ready` documented in protocol but not README commands section; no troubleshooting section for common install/agent-detection failures.

### 7. UX & product polish (8/10)
**Evidence:** Global `--help` lists agents, aliases, and examples; `poko status` gives compact readiness summary; `poko doctor` sections (Project, Source, Adapters, History, Native Sync, Compatibility, Warnings) are readable; `--json` on all major commands; `--dry-run --diff` and `--backup` for trust-building; history compatibility warnings are explicit and route-specific; tests verify private-display redaction in output and errors.

**Gaps:** macOS app-close/reopen flow for Cursor/T3 is disruptive (documented, not polished away); Cursor cross-agent resume limitation requires users to read compatibility table; no progress indicators for long sync operations.

### 8. Configuration & environments (7/10)
**Evidence:** `.poko/poko.json` is the canonical config; history store modes (`local`/`repo`/`both`) documented; `engines.bun >= 1.2.0`; `POKO_PRIVATE_DISPLAY=1` global option; lab harness isolates agent homes under `~/.poko/lab`; `.gitignore` excludes generated agent outputs and local history.

**Gaps:** No published install path yet (npm scoped rename pending); `package.json` `files` field would ship unintended sidecar binaries; no CONTRIBUTING guidance for dev environment setup beyond README Development section; Bun-only runtime may surprise npm users expecting Node compatibility (documented via engines, not in quick-start install).

### 9. Legal, licensing & compliance (7/10)
**Evidence:** MIT LICENSE at repo root (Copyright 2026 Poko contributors); `package.json` declares `"license": "MIT"`; OSS CLI is local-first with no user data collection to Poko servers; only 3 small OSS dependencies.

**Gaps:** No `NOTICE` file (low risk with 3 deps); scoped npm org `@poko-sh` creation not verified; package not yet published under intended name; no SECURITY.md or vulnerability reporting path.

### 10. Operational readiness (4/10)
**Evidence:** Public GitHub repo `poko-sh/poko-cli`; lab gate and HTML report for maintainer validation; `docs/publishing.md` outlines maintainer release steps; JSON protocol supports future desktop app integration.

**Gaps:** No `.github/ISSUE_TEMPLATE/`; no CONTRIBUTING.md, SUPPORT.md, or CHANGELOG; no CI status badge or automated release workflow; no documented support channel beyond GitHub issues (issues templates missing); no migration/upgrade guide for CLI flag or schema changes.

## Evidence log

| Check | Command / source | Result |
|-------|------------------|--------|
| Tests | `bun test` | pass (100/100) |
| Typecheck | `bun run typecheck` | pass |
| Lint/format | `bun run check` | **fail** (24 errors, 25 warnings) |
| Build | `bun run build` | pass |
| CLI help | `bun src/cli.ts --help` | pass |
| Status smoke | `bun src/cli.ts status` | pass |
| Doctor smoke | `bun src/cli.ts doctor` | pass (8 adapters detected) |
| npm publish | `npm view @poko-sh/cli version` | **not found** (404) |
| npm pack | `npm pack --dry-run` | pass but **59.4 MB** (sidecar included) |
| Dependency audit | `bun audit` / `npm audit` | not run (no audit script; npm needs lockfile) |
| CI workflows | `.github/workflows/` | **missing** |
| CI runs | `gh run list --limit 5` | none |
| LICENSE | `LICENSE` | MIT present |
| Secrets grep | `api_key|secret|password|token` in src | no hardcoded secrets |
| Git cleanliness | `git status --short` | **61 uncommitted files** on `main` |
| Lab gate | `tests/lab/lab.test.ts` | 23 pass, 1 manual, 0 fail |

## Next steps

### P0 — Ship blockers
- [ ] Add GitHub Actions CI running `bun test`, `bun run typecheck`, and `bun run check` on every push/PR — no automated gate exists today.
- [ ] Fix `package.json` `files` to exclude `dist/sidecars/` (or publish sidecars only via GitHub Releases) — `npm pack` currently ships a 58.5 MB binary.
- [ ] Rename package to `@poko-sh/cli`, create npm org, and publish `v0.1.0` per `docs/publishing.md` — strangers cannot install via documented `bunx`/`npx` path.
- [ ] Commit or branch the 61 in-flight changes and cut a clean release tag from a stable commit — `main` is not release-ready as-is.
- [ ] Fix biome check failures so the documented release checklist passes end-to-end.

### P1 — High risk
- [ ] Add a README end-to-end demo ("Codex → Claude Code resume" or similar) satisfying the roadmap release bar.
- [ ] Resolve the 1 manual lab gate check and document visual confirmation steps for Codex, Claude, Cursor, and one non-big-three agent.
- [ ] Add CONTRIBUTING.md, issue templates, and SECURITY.md for public OSS support expectations.
- [ ] Add CHANGELOG.md and tag-based release notes habit before `v1.0.0`.
- [ ] Document `poko agents wait-ready` in README; align README quick start with published install commands once npm is live.

### P2 — Polish
- [ ] Split `cursor-render.ts` and other 600+ line modules for long-term maintainability.
- [ ] Add `bun audit` or equivalent to CI once lockfile strategy is settled.
- [ ] Add troubleshooting section (agent not detected, macOS app-close failures, history store confusion).
- [ ] Exclude `.poko/v1-ship-audit-eval/` from biome checks or move eval artifacts out of lint scope.
- [ ] Add CI npm `pack --dry-run` size check to prevent accidental binary bloat.

## Audit limitations

- Dependency security audit was not completed: `bun audit` script absent and `npm audit` requires a package-lock; manual review shows only 3 small deps.
- npm org `@poko-sh` creation and maintainer publish access were not verified (only registry 404 confirmed).
- Real-agent visual confirmation was not run interactively; lab gate test result (1 manual) was used as proxy.
- Assessment run against a dirty `main` with 61 uncommitted files; scores may shift after those land.
- Paid desktop app, cloud sync, and Pro license gate were out of scope — this audit covers the OSS CLI only.
