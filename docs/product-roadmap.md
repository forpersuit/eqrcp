# EQT Product Roadmap

`EQT` is the product name for Easy QR Transfer. Keep `eqrcp` as the CLI,
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
      build、golangci-lint）。lint 暂设 `continue-on-error`，待一次
      基线清理后转为强制。
- [x] A3 修正 `.goreleaser.yml`：homepage 改为 `forpersuit/eqrcp`、
      加 `release.prerelease: auto`、加 changelog groups (符合规范第六节)。
- [x] A4 补全 `desktop/gui/wails.json` 元数据：`productName/productVersion/
      companyName/copyright/comments`，让 NSIS 安装器版本字段正确。

### Track B — 跨平台 (macOS / Linux 提升到可发布)

- [ ] B1 扩展 `scripts/build-artifacts.sh`：darwin 与 linux 分支调用 wails，
      产物落入 `dist/{platform}-{arch}/`，与 Windows 路径对齐。
- [ ] B2 macOS Wails：渲染 `desktop/gui/build/darwin/Info.plist`（bundle id
      `io.eqrcp.desktop`），生成 icns，文档化 codesign + notarize 流程。
- [ ] B3 Linux Wails：新增 `desktop/gui/build/linux/` 模板，AppImage 打包，
      `apt install libwebkit2gtk-4.1-dev` 列入 CI 前置。
- [ ] B4 `cmd/desktop_integration.go` 的 install/uninstall/startup/status：
      Linux 用 `.desktop` 文件 + `~/.config/autostart`，
      macOS 用 `LaunchAgents plist` + Finder Services。

### Track C — Release 流程 (依赖 A、B)

- [ ] C1 `.github/workflows/release.yml`：tag `v*` 触发，五个 job：
      `goreleaser-cli`、`wails-windows`、`wails-macos`、`wails-linux`、
      `aggregate-release`（softprops/action-gh-release 上传到同一 tag）。
- [ ] C2 `.github/release-drafter.yml`：按 Conventional Commits 自动分组
      草拟 release notes，替代手写 CHANGELOG。
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
- [ ] D4 QR 内容升级为 `https://signal.eqrcp.io/j/<code>#k=<key>`，
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
