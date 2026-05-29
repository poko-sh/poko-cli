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

Compact project readiness report for dashboards and menu bar status.

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
    "currentSessions": 2,
    "skippedOlderSessions": 1,
    "importers": []
  },
  "nativeSync": {
    "readyTargets": 8,
    "skippedTargets": 0,
    "targets": []
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

Same shape as `status`, with `command: "doctor"`. The desktop app can use this
when it wants the full adapter/native dry-run data.

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
    "nativeTargets": []
  },
  "warnings": []
}
```

Use `--dry-run --json` for app previews. Use `--backup --json` when the app is
executing a user-approved write.

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
      "title": "Same conversation everywhere",
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
- `sync --dry-run --json` for preview
- `sync --backup --json` for user-approved writes

The app should never parse human logs, ANSI color, or markdown handoff output.
