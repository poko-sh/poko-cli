# Poko Lab

Poko Lab is the reversible test harness for native history sync. It keeps agent
homes away from your real machine state, lets you preserve signed-in profiles,
and generates a small HTML report showing which stores were touched.

The default lab root is outside the repo:

```sh
~/.poko/lab
```

## Reset Model

There are two reset levels:

```sh
bun lab/poko-lab.ts reset
```

Resets the disposable run profile from the saved auth baseline. This clears test
chats/imports while keeping any login state that was saved into the baseline.

```sh
bun lab/poko-lab.ts reset --include-auth --yes
```

Deletes the signed-in baseline as well. This clears logins, tokens, preferences,
and test data for that lab profile.

## Local Flow

Create or refresh the disposable run:

```sh
bun lab/poko-lab.ts reset
```

Print the environment variables for the current run:

```sh
bun lab/poko-lab.ts env
```

Run Poko from source inside the copied lab workspace:

```sh
bun lab/poko-lab.ts run -- bun /Users/fraser/Documents/Development/poko/src/cli.ts doctor
```

Run the smoke check and write a visual report:

```sh
bun lab/poko-lab.ts smoke
```

Run the smoke check in write mode to prove target stores are actually mutated:

```sh
bun lab/poko-lab.ts smoke --write
```

Run the paid-launch synthetic gate:

```sh
bun run lab:gate
```

The gate resets the isolated run, seeds feature-rich source chats, previews a
full sync, writes into every native target, recaptures with another dry-run, and
fails if storage parity, lineage collapse, or duplicate-import checks regress.
Manual real-app visual checks are listed separately in the report because they
require opening the actual app/CLI.

The report is written to:

```sh
~/.poko/lab/profiles/default/runs/current/report/index.html
```

## Seeded Scenarios

`seed` creates realistic source chats for local importers without requiring real
agent installs:

```sh
bun lab/poko-lab.ts seed
bun lab/poko-lab.ts seed --agent codex,claude,cursor
```

`scenario` combines reset, seed, sync, and report generation:

```sh
bun lab/poko-lab.ts scenario list
bun lab/poko-lab.ts scenario codex-to-core --write
bun lab/poko-lab.ts scenario claude-to-core --write
bun lab/poko-lab.ts scenario cursor-to-core --write
bun lab/poko-lab.ts scenario all-to-all --write
bun lab/poko-lab.ts scenario reset-modes
```

Dry-run mode is the default. Add `--write` when you want Poko to write native
target stores. The report shows captured source sessions, target sessions, and
before/after counts.

## Preserving Login State

For GUI agents, sign in inside the disposable lab run first. Then save that run
home as the baseline:

```sh
bun lab/poko-lab.ts snapshot-auth --force
```

After that, normal `reset` commands restore from this baseline, so repeated
tests start signed in without keeping old imported chats.

When a GUI login does not survive inside the container, you can import selected
local macOS auth/profile state into the same lab baseline:

```sh
bun lab/poko-lab.ts import-auth --agent cursor,codex,claude,t3code,opencode,pi,hermes,openclaw --force --reset
```

This copies only into `~/.poko/lab` on your machine. It does not read token
contents, print secrets, or write auth material into the repo. Remove imported
auth with:

```sh
bun lab/poko-lab.ts reset --include-auth --yes
```

## Docker Flow

Build and enter the headless lab container:

```sh
docker compose -f lab/docker-compose.yml run --rm poko-lab
```

Inside the container:

```sh
bun install
bun lab/poko-lab.ts smoke
```

The container maps `/lab-state` to `~/.poko/lab` on the host, so reports and
baselines survive container deletion. Remove `~/.poko/lab` only when you want to
delete saved lab profiles and login state.

## GUI Flow

Start the noVNC desktop lane when you need to visually inspect GUI agents:

```sh
docker compose -f lab/docker-compose.gui.yml up
```

Open `http://localhost:3001`, then run this inside the desktop terminal:

```sh
/workspace/poko/lab/gui/bootstrap.sh
```

Use this lane for T3 Code Linux AppImage and Cursor Linux checks. See
`lab/gui/README.md` for the sign-in and snapshot flow.

## Agent Environment

The lab exports isolated state paths for native writers:

- `CODEX_HOME`
- `CLAUDE_CONFIG_DIR`
- `POKO_CURSOR_STORAGE_ROOT`
- `POKO_CURSOR_GLOBAL_STATE_DB`
- `POKO_T3CODE_DB_PATH`
- `POKO_OPENCODE_BIN`
- `POKO_LAB_OPENCODE_DB`
- `HERMES_HOME`
- `OPENCLAW_HOME`
- `OPENCLAW_STATE_DIR`
- `PI_CODING_AGENT_DIR`
- `XDG_CONFIG_HOME`
- `XDG_DATA_HOME`
- `XDG_STATE_HOME`

Cursor and T3 app lifecycle hooks are disabled in the headless lab environment.
The GUI lane is where we can opt back into app close/reopen behavior for desktop
apps.
