# EQT Product Roadmap

`EQT` is the product name for Easy QR Transfer. Keep `eqt` as the CLI,
binary, and transfer-core identity until packaging, migration, and user-facing
documentation are ready for a larger rename.

## Logo Generation Prompt

Use this prompt with an image-generation or logo-design tool:

```text
Design a clean app logo for "EQT" (Easy QR Transfer), a desktop utility for fast local QR-code based file transfer between computers and phones. Create a vector-friendly mark that combines a simplified QR corner motif, a subtle file/document shape, and a bidirectional transfer arrow. The logo should feel fast, practical, trustworthy, and lightweight, not social-media or crypto themed. Use a restrained modern palette with deep teal or green as the primary color, plus light and dark variants. It must remain recognizable at 16px and 32px tray-icon sizes, work as a monochrome icon, and avoid detailed full QR patterns, tiny text, gradients, shadows, 3D effects, mockups, and photographic elements. Provide a square app-icon composition with generous padding and a separate wordmark lockup reading "EQT" with the subtitle "Easy QR Transfer".
```

Negative prompt:

```text
No full dense QR code, no camera lens, no blockchain or crypto symbols, no cloud-sync metaphor, no mascot, no glossy 3D object, no tiny unreadable text, no complex background, no mockup scene.
```

Logo acceptance criteria:

- The mark is readable at Windows tray size.
- The icon still works in a single color.
- The QR reference is suggestive, not a scannable or fake detailed QR code.
- The transfer meaning is visible without relying on the subtitle.
- The square app icon and horizontal wordmark can be exported separately.

## Tray Interaction Plan

First principle: the tray icon should only be a control surface. It must call the
same desktop agent actions used by the GUI and CLI so transfer state remains in
one place.

Primary tray menu:

- `Open EQT`: show the main window.
- `Share...`: show the share workflow with the drop area focused.
- `Receive...`: show the receive workflow with the configured output directory.
- `Open Current QR`: open the active task QR page when a task exists.
- `Stop Current Transfer`: stop the active task when a task exists.
- `Settings`: open the settings surface.
- `About EQT`: show product, version, license, and support information.
- `Send Feedback`: open the feedback surface.
- `Quit`: close the GUI and leave the background agent policy explicit.

State behavior:

- Idle: neutral tray icon and tooltip `EQT is idle`.
- Share/receive waiting for scan: active tray icon and tooltip with the action.
- Transferring: active tray icon and tooltip with progress when available.
- Completed: short notification, then return to idle after history is updated.
- Failed/stopped: warning notification with an action to open details.
- Notification transport should use the native OS channel when available:
  Windows Toast first with a hidden balloon fallback, Linux `notify-send`, and
  macOS system notification through AppleScript. Notification failures must not
  fail or block transfers.
- `Quit EQT` must be explicit about whether it only closes the GUI shell or also
  stops the background agent. Product-facing wording should not expose the agent
  implementation unless the action is specifically about background service
  control.
- Current-task tray actions should apply to share, receive, and chat sessions;
  prefer `Open Current Task` over QR-only wording unless the active task is known
  to be a file transfer QR page.
- The current Wails tray menu now uses `Open Current Task`, `Stop Current Task`,
  `Stop Background Service`, and `Quit EQT App` to avoid conflating the GUI
  shell with the long-running background transfer service.

Workflow target:

1. User right-clicks tray icon and chooses `Share...`.
2. EQT opens as a compact drop window.
3. After files or folders are dropped, the pending list and `Transfer` / `Clear`
   actions appear.
4. After `Transfer`, the pending list is locked, the drop area becomes the QR
   and status surface, and each item shows transfer progress where the core can
   report it.
5. Terminal tasks immediately move out of current task and into history.

Implementation decision for the current Wails v2 track:

- Wails v2.12.0 does not expose a stable public system-tray API comparable to
  Wails v3 alpha.
- The local Wails v2 module contains internal and on-hold tray code, but using
  it would couple the product to unsupported implementation details.
- Do not migrate to Wails v3 only for tray support until v3 is stable enough for
  this product.
- Current implementation uses `fyne.io/systray` as the focused third-party Go
  tray library for the Wails v2 product line.
- The tray is a control surface over the Wails GUI and desktop agent. It does
  not duplicate transfer state or introduce a second task controller.
- Remaining tray work: dynamic menu state, progress tooltip updates,
  platform-specific icon variants, and Windows manual validation.

## About Surface

Initial Wails GUI support exists as a title-bar `About EQT` action.

The About surface should include:

- Product name: `EQT`.
- Subtitle: `Easy QR Transfer`.
- Application version, build date, commit, OS, and architecture.
- Core attribution: forked from `qrcp`, MIT license.
- Links to documentation, release notes, license text, feedback, and support.
- Update channel and current update status once signed updates exist.

## Feedback Surface

Initial Wails GUI support exists as a title-bar feedback action with a local
diagnostics preview and an email draft handoff.

Feedback should be explicit and privacy-preserving:

- Categories: bug, transfer failure, GUI issue, feature request, purchase or
  license issue, other.
- Optional contact email.
- Free-form message.
- Optional diagnostics bundle with app version, OS, architecture, config path,
  agent status, recent non-sensitive errors, and logs.
- A local preview before sending diagnostics.
- A clear note that files being transferred are never attached.

The first implementation can open a web feedback form or mail link. A later paid
product implementation should submit through a signed HTTPS endpoint with abuse
protection and support ticket IDs.

## Plus Trial Model

Current GUI behavior:

- Chat mode has a daily free usage allowance of 5 minutes.
- The timer starts when the user opens or starts chat mode, not when the app
  launches.
- Closing the app or leaving chat mode stops the active timer.
- Returning later on the same local calendar day continues using the remaining
  allowance until the 5 minutes are exhausted.
- After the allowance is exhausted, the GUI disables new chat sessions for that
  day, shows a paid upgrade prompt, and tries to stop the active chat task.

Product judgment:

- This is a reasonable trial gate because it lets users feel the feature without
  forcing account creation before value is obvious.
- The wording should be "daily free chat time" rather than "trial" if the free
  allowance resets every day.
- The gate should live in the desktop GUI/agent layer. Do not restrict the
  open-source CLI transfer primitives with a brittle paywall.
- Current metering is local to the desktop GUI and stored on the device. This is
  acceptable for early validation but is not enough for
  serious paid enforcement; a later license/account path should reconcile usage
  across reinstalls and multiple machines.

## Paid Product Gaps

Commercial value should live in desktop convenience, reliability, and support.
The local transfer core should remain simple, inspectable, and license-compliant.

Required product capabilities before charging:

- Signed installers and signed auto-updates.
- Windows uninstall, repair, startup, and upgrade behavior documented and tested.
- Native tray control surface.
- Clear About, license, privacy, feedback, and diagnostics surfaces.
- Crash reporting and diagnostics export with opt-in controls.
- Update channel management, release notes, rollback guidance, and version checks.
- License activation, offline grace period, device count policy, and plan display.
- Purchase recovery and support contact path.
- Basic accessibility and keyboard navigation pass.
- Packaging metadata for Windows, Linux, and macOS.

Paid feature candidates:

- Tray automation and one-click share/receive profiles.
- Persistent searchable history with retention controls.
- Batch queues and repeatable transfer jobs.
- Auto-receive profiles for trusted LAN workflows.
- Multi-device presets.
- Organization deployment controls.
- Priority support and managed update channels.

## 跨平台、P2P、Release 流水线开发计划

Plan recorded 2026-05-18. Progress markers: `[ ]` pending, `[~]` in progress,
`[x]` done, `[-]` deferred. Update inline as work lands.

### Track A — CI 基础 (unblocks everything else)

- [x] A1 决定 Go 版本基准。`go mod tidy` 推算出最低 `go 1.25`（依赖要求），
      最终采用 `go 1.25` + `toolchain go1.26.2`；workflow guide 的 CI 矩阵同步
      改为 `1.25 / 1.26`。`desktop/gui/go.mod` 仍是 1.23，独立 module 可保留。
- [x] A2 `.github/workflows/ci.yml`：matrix go-test、frontend build、lint。
      CI runner 不安装 `scripts/install-hooks.sh`，hook 不进入 CI 路径。
      落地：4 个 job（go-test 1.25/1.26、desktop GUI module、frontend
      build、golangci-lint）。lint 已经过 errcheck/unused 基线清理
      (commit `d889987`)，现在是强制 gate。
- [x] A3 修正 `.goreleaser.yml`：homepage 改为 `forpersuit/eqt`、
      加 `release.prerelease: auto`、加 changelog groups (符合规范第六节)。
- [x] A4 补全 `desktop/gui/wails.json` 元数据：`productName/productVersion/
      companyName/copyright/comments`，让 NSIS 安装器版本字段正确。

### Track B — 跨平台 (macOS / Linux 提升到可发布)

- [x] B1 扩展 `scripts/build-artifacts.sh`：darwin 与 linux 分支调用 wails，
      产物落入 `dist/{platform}-{arch}/`，与 Windows 路径对齐。新增
      `--cli-linux / --cli-macos / --cli-all` 选项交叉编译 CLI，host 为
      darwin 时 `build_gui_current` 会复制 `.app` 到 `dist/darwin-<arch>/`。
- [x] B2 macOS Wails：bundle id 改为 `io.github.forpersuit.eqt-desktop`
      (`build/darwin/Info.plist` + `Info.dev.plist`)，icns 由 Wails 从
      `build/appicon.png` 自动生成。codesign + notarize 流程文档化在
      `docs/wails-build-issue.md`，实际签名延后到 C3。
- [x] B3 Linux Wails：复用现有 `webkit2_41` build tag 支持，docs 补充
      `tar.gz / AppImage / deb` 三种打包选项的说明；AppImage 工具链
      具体接入留到 C1 (release.yml) 里再决定。
- [~] B4 `cmd/desktop_integration.go` 的 install/uninstall/startup/status：
      Linux 用 `.desktop` 文件 + `~/.config/autostart`，
      macOS 用 `LaunchAgents plist` + Finder Services。
  - [x] B4a 自启动跨平台：Linux `~/.config/autostart/eqt-agent.desktop`
        + macOS `~/Library/LaunchAgents/io.github.forpersuit.eqt-agent.plist`
        实现完成（install / uninstall / status 三个分支），含 round-trip 测试。
  - [ ] B4b Linux 文件管理器集成 (Nautilus 优先，KDE/Thunar 后续)
  - [ ] B4c macOS Finder Quick Actions / Services（需 C3 签名先到位）

### Track C — Release 流程 (依赖 A、B)

- [x] C1 `.github/workflows/release.yml`：tag `v*` 触发，4 个 job：
      `release-cli` (goreleaser ubuntu)、`release-wails-windows`、
      `release-wails-macos`、`release-wails-linux`。各 Wails job 用
      `softprops/action-gh-release@v2` 把 `.tar.gz`（macOS 是
      `eqt-desktop.app` 压成 tar.gz）追加到同一 tag。NSIS / AppImage /
      dmg 留到下一轮。
- [-] C2 release-drafter 暂不引入。当前流程「直接 commit 到 master + tag」
      不经过 PR，release-drafter 的 PR-based 草稿没数据可用。
      `.goreleaser.yml` 的 changelog groups (A3 已加) 已覆盖按 type 分组
      展示 changelog 的需求；切到 PR 流程后再开 C2。
- [-] C3 签名/公证：Apple Developer ID + Windows EV/OV 证书，延后到首个
      stable release 之前再做（钱+资质门槛）。

### Track D — P2P / STUN 跨网传输 (独立轨道)

- [ ] D1 抽出 `Transport` interface，把现 HTTP handler 改写为
      `httpTransport` 实现 (LAN 模式默认保留)。
- [ ] D2 Signaling 服务 MVP：轻量 WS 中继，短码复用现有 `random-path`，
      托管在公网小机器上 (或 Cloudflare Workers)。
- [ ] D3 集成 `github.com/pion/webrtc/v4`：PeerConnection + 两条
      DataChannel (`ctrl` JSON / `data` 二进制)。STUN 用
      `stun:stun.l.google.com:19302` 起步。
- [ ] D4 QR 内容升级为 `https://signal.eqt.io/j/<code>#k=<key>`，
      CLI 加 `--lan` / `--p2p` flag，握手失败时降级提示。
- [-] D5 TURN fallback：监控 ICE 失败率，超阈值再上 `coturn`。

### 推进顺序

1. A1 → A2 → A3 → A4 (CI 解死结，无外部依赖)
2. B1 → B2 / B3 并行 → B4 (macOS / Linux 提升到「能打包」)
3. C1 → C2 (打通自动发布)
4. D 与 A/B/C 并行；D1 之后才能继续 D2/D3
5. C3、D5 延后到产品需要时

### 进度同步

每完成一个条目，把 `[ ]` 改为 `[x]` 并补一行执行摘要（commit 哈希 + 一句
话影响），保留时间顺序。Bug/阻塞写到对应条目下方缩进。

### 已完成首次端到端验证

`v0.1.0-rc.2` (commit `d26b9c4`) 是第一次成功跑通发布流水线的 tag，产物：
- CLI: linux/darwin/windows × 386/amd64/arm/arm64 (tar.gz + zip)
- Linux: `.deb` + `.rpm` × 4 arch
- Wails GUI: `eqt-desktop-windows-amd64.exe`、
  `eqt-desktop-darwin-universal.tar.gz`、
  `eqt-desktop-linux-amd64.tar.gz`
- `checksums.txt`

首跑 CI/Release 红的根因 (commit `d26b9c4`):
1. goreleaser 报「archive has different count of binaries」——加
   `allow_different_binary_count: true`。
2. `go-test-desktop` 报 `pattern all:frontend/dist: no matching files`——
   在测试前补 `npm ci && npm run build`。
3. golangci-lint 报 Go toolchain 1.26 不兼容——改 `install-mode: goinstall`
   用 runner 自带 Go 重编 lint。
4. 6 条 errcheck/unused 基线清理 (commit `d889987`)。
5. lint 转为强制 gate (commit `609d80f`)。
