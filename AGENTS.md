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
- 一旦有功能增加，则小版本号+1

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


## Front-end & Go Engineering Best Practices (前端与 Go 后端开发最佳实践规则)

### 1. 前端开发规范 (JavaScript / TypeScript)
- **模块化分离 (Modularity & Separation of Concerns)**：
  - **规则**：禁止继续向 `main.js` 中无限制堆积新的功能模块。任何独立的业务交互、全局字典（如多语言 `translations`）、大块渲染模板，必须进行组件化或模块化剥离（在 `frontend/src/` 中拆分子文件）。
  - **合理性**：降低单文件膨胀度（控制在合理行数内），提高代码可读性，避免庞大文件发生 git 合并冲突。
- **数据状态与渲染分离 (State-Template Separation)**：
  - **规则**：渲染模板纯函数（以 `render` 开头的方法）中禁止直接修改全局 `state` 的值。状态修改必须由明确的 Controller 方法或事件处理函数统一调度。
  - **合理性**：理顺单向数据流。渲染函数应仅充当 `Data -> DOM` 的纯映射，避免局部 Side Effects 引发的状态漂移或内存泄露。
- **标准事件绑定 (Declarative Event Listeners)**：
  - **规则**：严禁在 HTML 字符串中拼装内联的全局 `onclick="..."` 事件。事件应当使用标准的 `addEventListener` 进行注册绑定。
  - **合理性**：降低全局作用域污染，提高调试可见性，且易于事件的生命周期清理，防范页面长期挂载导致内存溢出。

### 2. 后端开发规范 (Go 语言)
- **非阻塞异步外部网络调用 (Non-blocking Asynchronous Operations)**：
  - **规则**：在处理客户端轮询 HTTP 请求（如 `/status`）或 Wails 核心交互主线程中，绝对禁止同步阻塞式发起 network HTTP 请求或进行高时延 I/O。必须使用后台协程（goroutine）异步拉取并在内存中更新缓存。
  - **合理性**：确保客户端状态轮询在微秒级返回，防止网络延迟导致前端 GUI 挂起或抛出 `context deadline exceeded` 异常。
- **磁盘 I/O 隔离与内存缓存 (Memory Cache Isolation)**：
  - **规则**：高频查询的数据（如 `.lic` 证书与本地使用度限额等）必须实施内存缓存。只在发生写入或重置时更新缓存。
  - **合理性**：保护用户硬盘寿命，提升系统响应速度，避免频繁的磁盘读取造成严重的 I/O 卡顿。
- **设备指纹匹配空值防呆 (Robust Hardware Fingerprint Matching)**：
  - **规则**：在硬件特征比对时，若任何一方的值为空字符串 `""`，此字段判定比对直接跳过，不得被视作匹配成功。至少需要有 2 项有效的非空指纹相匹配才算合法。
  - **合理性**：确保因运行权限不足而造成部分特征缺失时，授权不被滥用。


# 15-rule template

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
Never compromise or disable existing features when adding new code. Identify and protect all legacy and concurrent behaviors in the modified area.
Verify backward compatibility: when editing a module, run regression checks on all related existing flows.
If a structural or design conflict is detected, stop immediately and raise it for user clarification instead of silently averaging or ignoring it.

## Rule 14 — Memory & Skill Consolidation (任务反思与技能固化)
- **Action Required**: At the end of every task, evaluate if there is any long-term engineering value to preserve (e.g., hidden configurations, environment traps, specific interactive commands, complex build workflows).
- **Consolidation**:
  - For new areas, define a new skill in the custom skills directory (e.g., `.agents/skills/<skill-name>/SKILL.md`).
  - For existing topics, update the corresponding skill file with progressive disclosure to keep instructions compact.
  - **Filter**: Only record reusable setup, debugging, and integration guidelines. Do NOT record temporary features or business-specific logic.
- **Reporting**: In your final delivery, explicitly declare which skills were updated or explain why no changes were required.

## Rule 15 — Definition of Done & Delivery Standards (定义完成与交付标准)
- **DoD (Definition of Done)**: A task is NOT complete until all the following criteria are met:
  1. **Compilation & Tests**: Code compiles without errors, and the test suite passes 100% with zero silent skips.
  2. **Acceptance & Deployment**: If core logic or integration boundaries change, execute project-specific deployment/build scripts to ensure physical artifacts are updated.
  3. **Git Cleanliness**: Working tree must be clean (no temp debug files left untracked), changes committed, and pushed to remote.
- **Delivery Artifact (交付汇报规范)**: Your final response MUST outline:
  - **What was modified**: A bullet list of edited files and their core change logic.
  - **How it was verified**: The exact commands run and a deterministic statement of runtime behaviors observed.
  - **Skills Updated**: Clear declaration of updated custom skills or explicit rationale for why no changes were required.




