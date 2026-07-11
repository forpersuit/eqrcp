# Repository Guidelines

## Need to obey

- use Chinese when we chat
- git push do not with proxy
- always base on First Principle
- unless the user explicitly says not to, close each completed change by staging, committing, and pushing the current worktree


## Project Structure & Module Organization

This repository is a Go command-line application forked from qrcp. The entry point is `main.go`; command definitions live in `cmd/`. Core transfer logic is in `server/`, payload creation is in `body/`, configuration handling is in `config/`, QR rendering is in `qr/`, and shared helpers are in `util/` and `logger/`.

Browser templates and embedded page markup are in `pages/`. Documentation and planning notes live under `docs/`, with static documentation assets in `docs/img/`. Tests are colocated with the package they cover, using Go’s `_test.go` convention.

## Build, Test, and Development Commands

Use standard Go tooling from the repository root:

```sh
go test ./...
go test ./server ./cmd
go build -o eqt .
go run . send ./example.txt
go run . receive ./downloads
```

For Windows binaries:

```sh
GOOS=windows GOARCH=amd64 go build -o eqt.exe .
GOOS=windows GOARCH=amd64 go build -ldflags -H=windowsgui -o eqt-launcher.exe ./cmd/eqt-launcher
```

Manual Windows acceptance deployment:

```sh
scripts/install-hooks.sh
```

The deployment script closes `eqt.exe`, `eqt-launcher.exe`, and `eqt-desktop.exe`, then writes fresh Windows artifacts to `E:\developer\results` on Windows or `/mnt/e/developer/results` under WSL/Linux. Use `EQT_RESULTS_DIR` only when the acceptance directory is intentionally different.

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


# 12-rule template

These rules apply to every task in this project unless explicitly overridden.
Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.

## Rule 1 — Think Before Coding
State assumptions explicitly. If uncertain, ask rather than guess.
Present multiple interpretations when ambiguity exists.
Push back when a simpler approach exists.
Stop when confused. Name what's unclear.

## Rule 2 — Simplicity First
Minimum code that solves the problem. Nothing speculative.
No features beyond what was asked. No abstractions for single-use code.
Test: would a senior engineer say this is overcomplicated? If yes, simplify.

## Rule 3 — Surgical Changes
Touch only what you must. Clean up only your own mess.
Don't "improve" adjacent code, comments, or formatting.
Don't refactor what isn't broken. Match existing style.

## Rule 4 — Goal-Driven Execution
Define success criteria. Loop until verified.
Don't follow steps. Define success and iterate.
Strong success criteria let you loop independently.

## Rule 5 — Use the model only for judgment calls
Use me for: classification, drafting, summarization, extraction.
Do NOT use me for: routing, retries, deterministic transforms.
If code can answer, code answers.

## Rule 6 — Token budgets are not advisory
Per-task: 4,000 tokens. Per-session: 30,000 tokens.
If approaching budget, summarize and start fresh.
Surface the breach. Do not silently overrun.

## Rule 7 — Surface conflicts, don't average them
If two patterns contradict, pick one (more recent / more tested).
Explain why. Flag the other for cleanup.
Don't blend conflicting patterns.

## Rule 8 — Read before you write
Before adding code, read exports, immediate callers, shared utilities.
"Looks orthogonal" is dangerous. If unsure why code is structured a way, ask.

## Rule 9 — Tests verify intent, not just behavior
Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

## Rule 10 — Checkpoint after every significant step
Summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back.
If you lose track, stop and restate.

## Rule 11 — Match the codebase's conventions, even if you disagree
Conformance > taste inside the codebase.
If you genuinely think a convention is harmful, surface it. Don't fork silently.

## Rule 12 — Fail loud
"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.