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
- Current implementation should keep preparing the GUI and agent actions so a
  tray frontend can be attached later without changing transfer semantics.
- Next implementation options are a focused third-party Go tray library for the
  Wails v2 product line, or a Wails v3 migration once stable.

## About Surface

The About surface should include:

- Product name: `EQT`.
- Subtitle: `Easy QR Transfer`.
- Application version, build date, commit, OS, and architecture.
- Core attribution: forked from `qrcp`, MIT license.
- Links to documentation, release notes, license text, feedback, and support.
- Update channel and current update status once signed updates exist.

## Feedback Surface

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
