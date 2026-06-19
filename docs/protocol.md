# Poko CLI/App Protocol

Poko's paid desktop app should treat the FOSS CLI as the local sync engine. The
app must call machine-readable `--json` commands instead of scraping terminal
copy.

## Principles

- JSON output is stable within a major CLI version.
- Human output can stay cute; JSON output should stay quiet and parseable.
- Raw chat contents are not emitted from status-style commands.
- Project `.poko/` remains the local source of truth.
- License, auth, cloud state, and app preferences belong outside project
  `.poko/`.

## Commands

### `poko status --json`

Compact project readiness report for dashboards and menu bar status. Uses the
stored history index only; it does not capture live agent history or run native
dry-run writes.

```json
{
  "schemaVersion": 1,
  "command": "status",
  "generatedAt": "2026-05-30T00:00:00.000Z",
  "project": {
    "root": "/path/to/project",
    "id": "project-id",
    "createdAt": "2026-05-29T00:00:00.000Z",
    "historyStore": "local",
    "historyOnSync": true
  },
  "sourceContext": {
    "text": {
      "rules": "present",
      "memory": "missing",
      "style": "missing",
      "stack": "missing"
    },
    "mcp": { "state": "missing", "servers": 0 },
    "skills": 0
  },
  "adapters": [],
  "history": {
    "indexedSessions": 2,
    "importers": [
      {
        "id": "codex",
        "enabled": true,
        "indexedSessions": 2
      }
    ]
  },
  "warnings": []
}
```

If a project has not been initialized, the command returns:

```json
{
  "schemaVersion": 1,
  "command": "status",
  "initialized": false,
  "root": "/path/to/project",
  "message": "Run `poko init` to create .poko/poko.json."
}
```

### `poko doctor --json`

Full readiness report with live history capture and native sync dry-run targets.
Same adapter/source-context fields as `status`, plus:

- `history.currentSessions` and `history.skippedOlderSessions` from live capture
- `nativeSync.readyTargets`, `nativeSync.skippedTargets`, and `nativeSync.targets`
- `historyCompatibility`
- route-specific warnings from `collectHistorySyncWarnings`

```json
{
  "schemaVersion": 1,
  "command": "doctor",
  "generatedAt": "2026-05-30T00:00:00.000Z",
  "project": {},
  "sourceContext": {},
  "adapters": [],
  "history": {
    "currentSessions": 2,
    "skippedOlderSessions": 1,
    "importers": []
  },
  "nativeSync": {
    "readyTargets": 2,
    "skippedTargets": 0,
    "targets": []
  },
  "historyCompatibility": {
    "summary": "Poko syncs project context everywhere it supports...",
    "primaryRoutes": [
      "Codex ↔ Claude Code — full native chat import and resume"
    ],
    "agents": []
  },
  "warnings": []
}
```

### `poko agents wait-ready --json`

Polls or waits until selected native-history agents are safe to write (app
closed and database unlocked).

```json
{
  "schemaVersion": 1,
  "command": "agents wait-ready",
  "generatedAt": "2026-05-30T00:00:00.000Z",
  "root": "/path/to/project",
  "timeoutMs": 30000,
  "ready": true,
  "agents": [
    {
      "id": "cursor",
      "ready": true
    }
  ]
}
```

When `--agents` is empty or omitted, `ready` is `false` and `agents` is `[]`.

Use `--probe` for a single readiness check without waiting.

### `poko sync --json`

Runs sync and returns file and history outcomes.

```json
{
  "schemaVersion": 1,
  "command": "sync",
  "dryRun": false,
  "noHistory": false,
  "agents": ["cursor"],
  "files": [
    {
      "path": ".cursor/rules/poko.mdc",
      "label": "Cursor project rule",
      "action": "updated",
      "backupPath": ".poko/backups/..."
    }
  ],
  "changedFiles": 1,
  "history": {
    "enabled": true,
    "sessions": [],
    "skippedOlderSessions": 0,
    "nativeTargets": [],
    "appCloseAgents": ["cursor"]
  },
  "historyCompatibility": {
    "summary": "Poko syncs project context everywhere it supports...",
    "primaryRoutes": [],
    "agents": []
  },
  "warnings": [
    "Cursor native chat sync imports cross-agent history for reading only..."
  ]
}
```

`history.appCloseAgents` lists native targets that went through app-close
orchestration during sync and require `requiresAppClose` in the capability
table. Before approving a write, the desktop app should call
`poko agents wait-ready --agents cursor,t3code --json` to confirm databases
are readable.

Use `--dry-run --json` for app previews. Use `--backup --json` when the app is
executing a user-approved write.

When Cursor is selected as a native history target, the desktop app should show
`historyCompatibility` and any Cursor-specific `warnings` before the user
approves sync. Do not present Cursor cross-agent imports as resumable chats.

The desktop app can pass `--targets claude,cursor,t3code` instead of `--all`
when the user selects explicit destinations.

### `poko sync --global --json`

Runs an all-project native history sync. This command does not write static
agent files and does not require the current working directory to contain
`.poko/`; when a discovered project has no `.poko/poko.json`, the CLI uses
default local history settings for that project.

```json
{
  "schemaVersion": 1,
  "command": "sync",
  "mode": "global",
  "dryRun": true,
  "agents": ["claude", "cursor"],
  "files": [],
  "changedFiles": 0,
  "history": {
    "enabled": true,
    "sessions": [
      {
        "id": "session-id",
        "sourceAgent": "codex",
        "title": "Build auth middleware",
        "projectRoot": "/path/to/project",
        "messages": 42
      }
    ],
    "skippedOlderSessions": 0,
    "nativeTargets": [
      {
        "target": "claude",
        "projectRoot": "/path/to/project",
        "location": "~/.claude/projects/...",
        "sessions": 1,
        "messages": 42,
        "dryRun": true,
        "skipped": false
      }
    ]
  },
  "global": {
    "projects": [
      {
        "root": "/path/to/project",
        "sessions": 1,
        "messages": 42,
        "sourceAgents": ["codex"]
      }
    ],
    "capturedAgents": [
      {
        "id": "codex",
        "displayName": "Codex",
        "supported": true,
        "capturedSessions": 1
      }
    ]
  },
  "warnings": []
}
```

### `poko capture --json`

Captures project history and reports per-importer counts.

```json
{
  "schemaVersion": 1,
  "command": "capture",
  "store": "local",
  "dryRun": false,
  "includePrevious": false,
  "capturedSessions": 2,
  "agents": [
    {
      "id": "codex",
      "displayName": "Codex",
      "capturedSessions": 2,
      "skippedOlderSessions": 1,
      "writtenEntries": 2
    }
  ]
}
```

### `poko restore --json`

Restores raw Poko sessions from a local JSON payload and imports them into
selected native history targets. The file can contain either `{ "session": {} }`
or `{ "sessions": [] }`. Restore requires explicit native targets via
`--targets` or `--all`.

```json
{
  "schemaVersion": 1,
  "command": "restore",
  "mode": "project",
  "dryRun": false,
  "agents": ["claude", "cursor"],
  "files": [],
  "changedFiles": 0,
  "history": {
    "enabled": true,
    "sessions": [
      {
        "id": "session-id",
        "sourceAgent": "codex",
        "title": "Build auth middleware",
        "projectRoot": "/path/to/project",
        "messages": 42
      }
    ],
    "skippedOlderSessions": 0,
    "nativeTargets": [
      {
        "target": "cursor",
        "location": "~/Library/Application Support/Cursor/...",
        "sessions": 1,
        "messages": 42,
        "dryRun": false,
        "skipped": false
      }
    ]
  },
  "historyCompatibility": {
    "summary": "Poko syncs project context everywhere it supports...",
    "primaryRoutes": [],
    "agents": []
  },
  "warnings": []
}
```

### `poko history --json`

Returns the captured history index for the active project.

```json
{
  "schemaVersion": 1,
  "command": "history",
  "store": "local",
  "entries": [
    {
      "id": "session-id",
      "sourceAgent": "codex",
      "title": "Build auth middleware",
      "projectRoot": "/path/to/project",
      "updatedAt": "2026-05-30T00:00:00.000Z",
      "messageCount": 42,
      "path": "sessions/codex/codex-session-id.jsonl"
    }
  ]
}
```

## App Contract

The desktop app should call the sidecar with an explicit project working
directory when operating on a selected project. The initial app MVP only needs:

- `status --json` for project cards and menu bar health
- `history --json` for the latest conversation list
- `agents wait-ready --agents cursor,t3code --json` before SQLite writes
- `sync --dry-run --json` for preview
- `sync --backup --json` for user-approved writes
- `sync --global --targets <list> --dry-run --json` for all-project previews
- `sync --global --targets <list> --json` for user-approved all-project writes
- `restore --file <path> --targets <list> --json` for cloud restore writes

The app should never parse human logs, ANSI color, or markdown handoff output.
