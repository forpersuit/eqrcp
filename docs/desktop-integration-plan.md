# Desktop Integration Plan

## Goal

Make `eqrcp` usable without typing commands in a terminal.

The desired workflows are:

- Right click a file and choose `Share with eqrcp`.
- Right click multiple files and share them as one transfer.
- Right click a folder and share that folder.
- Right click inside a folder and choose `Receive here with eqrcp`.
- Show the QR code automatically so a phone can scan it.

The current CLI already provides the transfer engine. Desktop integration should wrap that engine instead of replacing it.

## Current Transfer Engine

Existing commands already cover the core behavior:

```sh
eqrcp <file>
eqrcp <file1> <file2>
eqrcp <directory>
eqrcp receive --output <directory>
```

Useful flags for desktop mode:

- `--browser`: opens a browser QR page.
- `--output`: chooses receive destination.
- `--interface`, `--bind`, `--fqdn`: control generated URLs.
- `--keep-alive`: keeps the service running after transfer.

## Strategy

Use a staged approach.

### Phase 0: Document And Validate

Status: completed.

Deliverables:

- Record baseline tests in `docs/test-analysis.md`.
- Record platform integration details in `docs/desktop-platform-notes.md`.
- Record security limits in `docs/security-notes.md`.
- Keep the CLI behavior stable while planning desktop commands.

Exit criteria:

- Build and test pass.
- Send and receive loopback flows are documented.
- Desktop command shape is agreed before implementation.

### Phase 1: Desktop-Oriented CLI Commands

Add commands that are safe to launch from file managers:

```sh
eqrcp desktop share <paths...>
eqrcp desktop receive <directory>
eqrcp desktop install
eqrcp desktop uninstall
```

Status:

- `eqrcp desktop share <paths...>` is implemented.
- `eqrcp desktop receive <directory>` is implemented.
- `eqrcp desktop install` is implemented for Windows.
- `eqrcp desktop uninstall` is implemented for Windows.
- `eqrcp desktop status` is implemented for Windows and returns a platform note elsewhere.
- Non-Windows install and uninstall paths currently return a not implemented error.

Expected behavior:

- `desktop share` wraps the existing send flow.
- `desktop receive` wraps the existing receive flow.
- Both default to opening a visible QR code through `--browser` or a future QR window.
- Both should avoid requiring a terminal.
- Errors should be visible through system notifications, a browser error page, or a small dialog.

Implementation notes:

- Reuse existing `body`, `config`, `server`, and `qr` packages.
- Do not duplicate transfer logic in platform-specific scripts.
- Keep command flags compatible with existing global flags.
- Treat file manager paths as untrusted input and validate them before transfer.

Exit criteria:

- `eqrcp desktop share file.txt` shares a file.
- `eqrcp desktop share dir/` shares a directory.
- `eqrcp desktop receive /tmp` receives into `/tmp`.
- The commands work without terminal input.

### Phase 2: Install And Uninstall Context Menus

Add platform-specific installers behind:

```sh
eqrcp desktop install
eqrcp desktop uninstall
```

Status:

- Windows user-level registry integration is implemented.
- Windows right-click launching uses hidden PowerShell to avoid the console-tool prompt.
- Linux and macOS installers are documented but not implemented.

The installer should:

- Detect the current OS.
- Install user-level context menu entries by default.
- Avoid requiring administrator rights for normal installs.
- Print exactly what was installed.
- Provide a reversible uninstall path.

Exit criteria:

- Windows Explorer has share and receive entries. Implemented, pending manual Windows validation.
- macOS Finder has Quick Actions or Services. Not implemented.
- Linux has at least Nautilus support, with KDE documented. Documented, not implemented.
- Uninstall removes entries created by install. Implemented for Windows, pending manual Windows validation.

### Phase 2.1: Windows Daily-Use Polish

Status: in progress.

Focus:

- Validate Windows Explorer behavior after real right-click usage.
- Add `eqrcp desktop status` so users can inspect installed registry commands.
- Investigate practical multi-select support for Windows Explorer.
- Add a Windows Send To entry for multi-select sharing.
- Decide whether a separate no-console launcher is needed.
- Add `eqrcp-launcher.exe` as an optional no-console launcher for context menu entries.
- Improve visible error reporting for no-terminal launches.

Priority:

1. `desktop status`.
2. Windows multi-select behavior through Send To.
3. No-console launcher design and implementation.
4. User-visible error reporting.

Exit criteria:

- `eqrcp desktop status` reports all installed Windows entries and their command strings.
- Single file share, folder share, folder receive, and folder-background receive are manually validated.
- Multi-select support is available through `Send to > Share with eqrcp`, or a limitation is documented.
- `eqrcp-launcher.exe` is available for Windows builds and is used by `desktop install` when it sits next to `eqrcp.exe`.
- `eqrcp-launcher.exe` writes child process output to a cache log and shows a Windows message box if `eqrcp` exits with an error.

### Phase 3: Better QR And Status UI

After the right-click workflow is functional, improve visibility:

- Dedicated QR window.
- Copy URL button.
- Stop server button.
- Transfer status.
- Last used output directory.
- System tray entry.

This phase may require a GUI library or a browser-based local UI. Do not start here unless Phase 1 and Phase 2 expose a real need.

## Recommended First Implementation

Start with Phase 1 and implement:

```sh
eqrcp desktop share <paths...>
eqrcp desktop receive <directory>
```

Use the browser QR page initially. It is already implemented and avoids introducing GUI dependencies.

Then implement Windows and Linux installers. macOS can be documented first if no macOS environment is available for testing.

## Open Questions

- Should desktop mode always imply `--browser`?
- Should desktop mode suppress terminal QR output?
- Should failures use native notifications or open a browser error page first?
- Should `desktop receive` default to the clicked directory or the configured output directory when both are available?
- Should right-click share use `--keep-alive` for multiple phone downloads?
- Should the context menu expose both `Share once` and `Share and keep alive`?

## Risks

- File manager APIs differ significantly across platforms.
- Multi-select support is simple on Linux scripts but less simple with basic Windows registry entries.
- Desktop launches often have no terminal, so current stdout/stderr output may be invisible.
- First-run network interface selection may block or confuse desktop users.
- Antivirus or OS security policy may object to a binary that starts a local server.
