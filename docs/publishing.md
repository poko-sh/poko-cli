# Publishing Poko CLI

Poko CLI is the free, open-source sync engine. The paid desktop app and website
can depend on it, but the CLI should be useful on its own.

## Channel Decision

Publish the CLI to npm first.

Why npm first:

- AI coding-tool users already have Node, Bun, npm, pnpm, or npx-style tooling.
- It is cross-platform without separate macOS, Linux, and Windows package work.
- The CLI is TypeScript/Bun-native, so npm is the natural public registry.
- `bunx`, `npx`, and global npm installs give us a fast try-before-install path.
- Homebrew is excellent for macOS convenience, but it adds tap/bottle maintenance
  and should trail npm once the release process is stable.

The bare npm package name `poko` is already owned by another package. Use a
scoped package:

```json
{
  "name": "@poko.sh/cli",
  "bin": {
    "poko": "./dist/cli.js"
  }
}
```

Users still run `poko`; only the package install name is scoped.

## Install UX

Primary install commands:

```sh
bunx @poko.sh/cli init
npx @poko.sh/cli init
npm install -g @poko.sh/cli
bun add -g @poko.sh/cli
```

Later Homebrew install:

```sh
brew tap poko-sh/tap
brew install poko
```

Homebrew should install a compiled standalone binary from GitHub Releases, not
rebuild the TypeScript package locally.

## npm Release Checklist

### One-time setup (Trusted Publishing)

Use [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) instead
of a long-lived `NPM_TOKEN`. This avoids 2FA OTP failures in CI and is npm's
recommended path for GitHub Actions.

1. Create the `@poko.sh` npm organization.
2. Add publish access for maintainers.
3. On npmjs.com, open the `@poko.sh/cli` package settings (or org publishing
   settings for a new package) and add a **Trusted Publisher**:
   - Provider: **GitHub Actions**
   - Organization or user: `poko-sh`
   - Repository: `poko-cli`
   - Workflow filename: `release.yml` (exact match, including `.yml`)
   - Environment: leave empty unless you add a GitHub environment later
4. Do **not** store `NPM_TOKEN` in GitHub secrets for releases. The workflow
   uses OIDC via `permissions: id-token: write`.
5. Keep the executable name in `bin` as `poko`.

Per release:

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run check
bun run build
npm pack --dry-run
npm publish --access public
```

Recommended release command once automated:

```sh
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions runs the checks, builds `dist`, publishes via trusted publishing,
and attaches release notes on tag push. The release workflow requires npm CLI
v11.5.1+ and upgrades npm automatically before `npm publish`.

## Versioning

Use semver:

- Patch: adapter fixes, detection fixes, doc/output polish.
- Minor: new adapters, new commands, new native sync support.
- Major: breaking CLI flags, changed history payload schema, or changed native
  restore contract.

The desktop app bundles a compiled CLI sidecar, so app releases should record
the CLI version they bundle in release notes.

## Homebrew Later

Homebrew is worth adding after npm because it gives a polished macOS install:

```sh
brew install poko-sh/tap/poko
```

Use a separate tap repo, likely `poko-sh/homebrew-tap`, with a formula that
downloads the macOS standalone binary from GitHub Releases. Update the formula
from the release workflow after checks pass.

Do not make Homebrew the first release channel. It is great as a convenience
layer, not as the source of truth.

## Other Channels Later

Add these only after npm and Homebrew are boring:

- GitHub Releases: standalone binaries for app sidecars and manual downloads.
- Scoop or winget: Windows convenience.
- AUR: Linux power users, if there is demand.

The CLI remains free in every channel.
