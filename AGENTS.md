# Repository Guidelines

## Need to obey

- git push do not with proxy
- always base on First Principle
- before handing work to manual Windows acceptance, close running eqrcp desktop processes and deploy fresh Windows artifacts to `E:\developer\results`
- keep the acceptance deployment mechanism environment-stable by using `scripts/deploy-windows-results.sh`; do not rely on memory or ad hoc commands

## Project Structure & Module Organization

This repository is a Go command-line application forked from qrcp. The entry point is `main.go`; command definitions live in `cmd/`. Core transfer logic is in `server/`, payload creation is in `body/`, configuration handling is in `config/`, QR rendering is in `qr/`, and shared helpers are in `util/` and `logger/`.

Browser templates and embedded page markup are in `pages/`. Documentation and planning notes live under `docs/`, with static documentation assets in `docs/img/`. Tests are colocated with the package they cover, using Go’s `_test.go` convention.

## Build, Test, and Development Commands

Use standard Go tooling from the repository root:

```sh
go test ./...
go test ./server ./cmd
go build -o eqrcp .
go run . send ./example.txt
go run . receive ./downloads
```

For Windows binaries:

```sh
GOOS=windows GOARCH=amd64 go build -o eqrcp.exe .
GOOS=windows GOARCH=amd64 go build -ldflags -H=windowsgui -o eqrcp-launcher.exe ./cmd/eqrcp-launcher
```

Manual Windows acceptance deployment:

```sh
scripts/deploy-windows-results.sh
scripts/install-hooks.sh
```

The deployment script closes `eqrcp.exe`, `eqrcp-launcher.exe`, and `eqrcp-desktop.exe`, then writes fresh Windows artifacts to `E:\developer\results` on Windows or `/mnt/e/developer/results` under WSL/Linux. Use `EQRCP_RESULTS_DIR` only when the acceptance directory is intentionally different.

## Coding Style & Naming Conventions

Run `gofmt` on changed Go files before committing. Keep package-level names clear and idiomatic: exported identifiers use `CamelCase`, unexported identifiers use `camelCase`, and tests use `TestNameBehavior`. Prefer existing package boundaries and helpers over adding new abstractions.

Keep comments short and useful. Avoid broad refactors when changing transfer behavior, desktop integration, or status reporting.

## Testing Guidelines

Use Go’s built-in `testing` package. Add focused tests next to the modified code, especially for server state transitions, desktop agent behavior, launcher errors, and config migration. Run `go test ./...` before submitting. For narrow work, also run targeted packages such as `go test ./server ./cmd`.

## Commit & Pull Request Guidelines

Recent history uses short imperative commit messages, for example `Add agent-level transfer repeat` and `Push transfer status updates to browser pages`. Follow that style.

Pull requests should include a concise behavior summary, test commands run, and any manual Windows validation notes when desktop integration changes. Link related issues when available and include screenshots only for visible browser or desktop UI changes.

## Security & Configuration Tips

Do not commit local config, generated binaries, logs, or received files. Keep network-facing changes scoped and document any new routes in `docs/test-analysis.md` or the desktop integration plan when relevant.
