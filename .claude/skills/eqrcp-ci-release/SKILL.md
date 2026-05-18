---
name: eqrcp-ci-release
description: Hard-won gotchas for eqrcp CI/Release pipeline — load when working on .github/workflows/*.yml, .goreleaser.yml, wails.json, desktop/gui/build/*, scripts/build-artifacts.sh, or diagnosing failing GitHub Actions runs in this repo.
---

# eqrcp CI / Release pipeline — gotchas that aren't in any doc

These are practice-only lessons from setting up the multi-platform release
pipeline. Each entry is something that cost time to discover but is invisible
when reading source.

## 1. golangci-lint vs go.mod toolchain mismatch

The `golangci/golangci-lint-action@v6`-bundled binary is compiled with an
older Go (1.24 as of this writing). When `go.mod` carries
`toolchain go1.26.2`, lint refuses to load with:

```
the Go language version (go1.24) used to build golangci-lint is lower than
the targeted Go version (1.26.2)
```

Fix in `ci.yml`:

```yaml
- uses: golangci/golangci-lint-action@v6
  with:
    version: latest
    install-mode: goinstall   # rebuild lint with runner's Go
    args: --timeout=5m
```

## 2. //go:embed all:frontend/dist requires npm build first

`desktop/gui/main.go` line 13 has `//go:embed all:frontend/dist`. Any
`go test`, `go vet`, or `go build` on that module fails with
`pattern all:frontend/dist: no matching files found` unless
`frontend/dist/` exists.

- `wails build` runs `npm install && npm run build` automatically (via
  `wails.json:frontend:install` / `frontend:build`), so release Wails jobs
  don't need an explicit npm step.
- `go test ./...` in `desktop/gui` does **not** go through wails. CI must
  run `npm ci && npm run build` in `desktop/gui/frontend/` **before** any
  go command in `desktop/gui/`.

## 3. goreleaser CLI + launcher → "different binary count" error

`.goreleaser.yml` has two builds (`eqrcp` cross-platform + `eqrcp-launcher`
windows-only). Default archive layout produces inconsistent binary counts
per platform and goreleaser v2 rejects it:

```
invalid archive: archive has different count of binaries for each platform
```

Smallest fix:

```yaml
archives:
  - format_overrides:
    - goos: windows
      formats: [tar.gz, zip]
    allow_different_binary_count: true
```

Result: Windows archives are "fat" (contain both `eqrcp.exe` and
`eqrcp-launcher.exe`); Linux/macOS contain only `eqrcp`.

## 4. Root .gitignore swallowed desktop/gui/build scaffold

The root `.gitignore` originally had bare `build/` which is a non-anchored
rule — it matches `build/` at any depth, including `desktop/gui/build/`.

This silently kept `desktop/gui/build/{darwin,windows,appicon.png,
installer/}` out of git. Wails would re-generate them on `wails init`, but
**any changes to `Info.plist` / NSIS templates were local-only and lost on
clone**.

Fix: anchor the rule with leading slash, and explicitly ignore only the
binary output:

```gitignore
/build/
desktop/gui/build/bin/
```

Then `git add` the scaffold files explicitly. `git check-ignore -v <path>`
is the diagnostic tool.

## 5. pre-commit hook is local-only, not in CI

`scripts/install-hooks.sh` writes to `.git/hooks/pre-commit` which is
**not** committed. CI runners never run it. The Windows-specific
`deploy-windows-results.sh` inside the hook is therefore not a CI
blocker — earlier audit got this wrong.

## 6. Release workflow timing: goreleaser must create the release first

When `release.yml` uses goreleaser + parallel Wails jobs that upload to
the same tag via `softprops/action-gh-release@v2`, the Wails jobs
**must** declare `needs: release-cli`. Otherwise they race and either
duplicate-create the release or fail because the release doesn't exist
yet.

`softprops/action-gh-release@v2` appends assets to an existing release
matching `tag_name`, so all post-goreleaser jobs are safe to run in
parallel once the gate is open.

## 7. macos-latest runs darwin/universal fine

`wails build -clean -platform darwin/universal` works on `macos-latest`
(arm64 runner since 2024). Produces a fat `.app` with both archs. No
need to split into `darwin/amd64` + `darwin/arm64` jobs.

Linux: must `apt install libwebkit2gtk-4.1-dev libgtk-3-dev` on the
runner, and use Wails build tag `-tags webkit2_41`. Older `4.0`
fallback would be `-tags webkit2_40` if a newer runner image isn't
available.

## 8. `go mod tidy` raises the `go` directive automatically

Lowering `go.mod`'s `go` directive doesn't stick. `go mod tidy` re-reads
all indirect deps and bumps it to the **highest minimum required by any
dep**. Currently lands at `go 1.25.0` regardless of attempts to set
`1.23`.

`toolchain go1.26.2` is the actual local Go version (separate from `go`
directive). CI runners obey it via auto-download if needed.

## 9. gh CLI workflow for CI debugging

Default tools when the user has `gh` authenticated:

```bash
gh run list --limit 8                            # last N runs across workflows
gh run list --workflow CI --limit 5              # filter by workflow
gh run view <run-id>                             # job-level summary
gh run view --job <job-id> --log                 # raw log of one job
gh run view <run-id> --log-failed                # failed steps only
gh run watch <run-id> --exit-status --interval 15  # block until done
```

Filter raw log for errors:

```bash
gh run view --job <id> --log | grep -E "^.*\t(##\[error\]|Error|FAIL)" | head
```

## 10. wails build invokes npm; bare go test doesn't

When writing CI for Wails projects with embedded frontend:

| Step                    | Runs npm? |
| ----------------------- | --------- |
| `wails build`           | yes (via wails.json frontend hooks) |
| `wails dev`             | yes |
| `go build` on desktop module | no — fails on missing embed |
| `go test` on desktop module  | no — fails on missing embed |

So release-wails-* jobs are minimal (just `wails build`), but
`go-test-desktop` in ci.yml needs an explicit `npm ci && npm run build`.

## Common commit patterns from this repo

- `ci:`, `chore:`, `build:`, `fix:`, `docs:`, `perf:`, `refactor:` per the
  Conventional Commits spec documented in `docs/github-workflow-guide.md`.
- Most commits are direct-to-master (no PRs), so changelog comes from
  `.goreleaser.yml` `changelog.groups`, not from PR labels.
- Tag `v0.X.Y` triggers full release. Pre-release: `v0.X.Y-rc.N` or
  `-beta.N` — `release.prerelease: auto` in goreleaser handles the
  pre-release flag.

## What this skill does NOT cover

- Code signing (Apple notarization + Windows signtool) — see roadmap C3.
- macOS / Linux desktop integration (Finder Services / .desktop files) —
  see roadmap B4.
- Lint baseline drift — when introducing new code that triggers
  `errcheck` / `unused`, follow the patterns in `server/chat.go:296` and
  similar (`if err := ...; err != nil { log.Println(err) }`).
