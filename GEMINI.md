# Repository Guidelines

## Need to obey

- use Chinese when we chat
- use `scripts/git-push-smart.sh` for GitHub pushes in WSL: if direct `ping x.com` works it pushes without proxy; otherwise it uses the Windows host proxy from the commented `~/.bashrc` pattern (`ip route` host + port `10808`) through SSH `ProxyCommand`
- always base on First Principle
- unless the user explicitly says not to, close each completed change by staging, committing, and pushing the current worktree
- before handing work to manual Windows acceptance, close running eqt desktop processes and deploy fresh Windows artifacts to `E:\developer\results`
- keep the acceptance deployment mechanism environment-stable by using `scripts/deploy-windows-results.sh`; do not rely on memory or ad hoc commands
- avoid alert-style prompts (such as browser-level alert dialogs) for user warnings, errors, or size limit messages; always use in-app notifications (e.g., appending system messages to the chat message list) instead
- replace grep by rg

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
scripts/deploy-windows-results.sh
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

## Project Skill Notes

When changing product branding, logo, or desktop icons, check every visible and build-time surface:

- `docs/img/transparent.png` is the source image for square icons, tray icons, favicons, and app icons.
- `docs/img/logo-design-horizontal.png` is the source image for horizontal brand surfaces such as About.
- Regenerate derived assets with `go run ./scripts/icon-assets docs/img/transparent.png docs/img/logo-design-horizontal.png` when either source changes.
- `docs/img/logo.png` is a retained product mark source image from the logo set.
- `desktop/gui/build/appicon.png` feeds Wails app icon generation.
- `desktop/gui/build/windows/icon.ico` feeds Windows executable and installer icons.
- `desktop/gui/frontend/src/assets/images/logo-universal.png` feeds the tray icon and visible desktop GUI logo surfaces.
- `pages/assets/favicon.png` and `pages/assets/eqt-logo-mark.png` feed browser templates through server routes; do not inline large PNGs into templates.
- `desktop/gui/frontend/src/main.js` and `desktop/gui/frontend/src/app.css` control visible in-app logo usage such as the top bar, About panel, and favicon.
- `desktop/gui/tray.go` embeds `logo-universal.png`; rebuild after replacing that file.

After branding, desktop integration, chat-device, or Windows-facing changes, use `scripts/deploy-windows-results.sh` as the validation and artifact refresh path. It closes existing EQT desktop processes, runs tests, builds the frontend, builds Windows CLI/launcher/desktop artifacts, and writes fresh results to `E:\developer\results` or `/mnt/e/developer/results`.

For GitHub push network selection, use `scripts/git-push-smart.sh` instead of raw `git push` when working from WSL. On 2026-05-24 in the current network, `ping x.com` failed; 4 MiB remote push tests showed direct SSH 22 and SSH 443 timed out at 240s, Windows-proxy SSH 22 completed in 112s, and Windows-proxy SSH 443 completed in 124s. Therefore proxy SSH 22 is the preferred fallback when direct reachability fails.


# 14-rule template

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

## Rule 13 — Zero Tolerance for Regression (防止功能退化)
Never silently compromise or disable existing features when adding new functionality. Identify and protect all legacy and concurrent behaviors in the modified area.
Test explicitly for backward compatibility: when editing a module (such as settings, styles, layout logic, or network actions), run a regression check on existing flows.
If a structural or design conflict is detected, stop immediately and raise it for user clarification instead of silently averaging, ignoring, or hiding it.

## Rule 14 — Memory & Skill Consolidation (任务反思与技能固化)
- **Action Required**: At the end of every single task, you must explicitly evaluate if there is any long-term engineering value to preserve (e.g., hidden configs, environment traps, specific interactive commands, Wails build workflows).
- **Consolidation**:
  - If it is a new area, define a new skill in `.agents/skills/<skill-name>/SKILL.md`.
  - If it belongs to an existing module, update the corresponding skill (such as `eqt-dev`, `eqt-ux`, `eqt-drm`) with Progressive Disclosure to keep the instructions compact.
  - **Filter**: Only record reusable setup, debugging, and integration guidelines. Do NOT record temporary project features or business-specific changes to avoid noise.
- **Reporting**: In your final delivery, you must explicitly declare which skills were updated or why no updates were necessary.


