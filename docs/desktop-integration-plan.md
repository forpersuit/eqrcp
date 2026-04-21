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
- Launcher error formatting has automated tests for argument errors, command display, log path display, and log tail display.
- Native Windows launcher error dialogs were manually validated and now use `MessageBoxW` directly instead of PowerShell.
- `desktop status` now reports stale registry commands, stale Send To scripts, the current executable path, the expected launcher path, and repair guidance.
- Windows manual validation: `desktop status` no longer misreports repaired entries as `needs repair` on localized Windows registry output.

### Phase 3: Better QR And Status UI

Status: in progress.

After the right-click workflow is functional, improve visibility:

- Dedicated QR window.
- Copy URL button. Implemented in the browser QR page.
- Stop server button. Implemented in the browser QR page.
- Transfer status. Implemented in the browser QR page through `/qr/status` polling.
- Transfer service status. Implemented: `/qr/status` returns the current QR transfer state, while `/status` returns service-level state with the current transfer and history.
- Transfer URL status alias. Implemented: appending `/status` to the active send or receive URL returns the current transfer state.
- Repeat scan handling. Implemented: completed or stopped one-shot transfer URLs now return `410 Gone` with a clear message instead of starting a confusing second transfer attempt.
- Completion cleanup. Implemented: when `/qr/status` reaches `completed` or `stopped`, the QR code, copy URL field, stop button, and waiting hint are hidden from the browser QR page.
- Archive clarity. Implemented: directory and multi-file downloads use timestamped zip names, and the browser QR page lists the original selected items while separately showing the zip archive name.
- QR page purpose labels. Implemented: the page identifies share vs receive and shows the target file, archive, or output directory.
- Basic transfer progress. Implemented: `/qr/status` exposes byte counters and percent for browser display.
- Receive completion details. Implemented: `/qr/status` records the files saved during receive and the QR page displays them after upload.
- Mobile upload completion page. Implemented: after phone upload, the success page lists each saved file and uses a small mobile-friendly layout.
- Last used output directory. Partially implemented: `eqrcp desktop receive` can now run without a directory and uses the configured output directory or current working directory, while right-click receive still passes the clicked directory explicitly.
- System tray entry.

The first implementation stays browser-based to avoid adding GUI dependencies. `/qr` now opens an HTML control page, `/qr/image` serves the QR image, `/qr/status` returns the current transfer state, and `/qr/stop` stops the current transfer.

When the browser QR page is enabled, successful one-shot transfers keep the server alive briefly after completion so the control page can show `completed` before the process exits.

Current progress model:

- Send progress counts bytes written by the server response and caps the UI at 100%.
- Receive progress counts bytes read from uploaded file parts and uses the request content length as the best available total.
- Browser range or parallel download requests may make send progress approximate, but the UI should remain monotonic and never exceed 100%.

Next priorities:

1. Validate progress, QR completion cleanup, timestamped archive names, and mobile upload completion pages in Windows right-click share and receive flows.
2. Validate `eqrcp desktop receive` without a directory, using the configured output directory or current working directory.
3. Validate setup repair checks for stale Windows registry paths and missing launcher placement on Windows.

### Phase 4: Desktop Agent And Single Instance

Status: in progress.

The current Windows desktop flow starts one `eqrcp-launcher.exe` and one `eqrcp.exe` process per right-click action. This is acceptable while validating single-transfer behavior, but it can leave many waiting processes when users start several shares or receives.

The planned fix is a desktop agent:

- `eqrcp desktop agent` runs as the single long-lived process. Initial command and local API are implemented and manually validated on Windows.
- `eqrcp-launcher.exe` forwards right-click requests to the agent instead of starting a full transfer process directly. Manually validated on Windows.
- The agent owns transfer lifecycle, status pages, stop actions, and cleanup. It runs one active task at a time; when a new right-click task arrives, it stops the current task and starts the next one instead of launching extra transfer processes. Manually validated on Windows.
- The agent can later expose a tray icon and current-task list.
- The agent should prevent stale orphaned transfers from accumulating.

Initial local API:

- `GET /health` checks whether the agent is alive.
- `GET /status` returns `idle` or `busy`, the active task, queued task count, and the last task error.
- `GET /status` returns recent task history with `running`, `completed`, `failed`, or `replaced` states.
- `GET /` serves a browser-based agent status page with the current task, recent history, local stop actions, and automatic `/status` polling.
- Active agent tasks now include the browser QR page URL, and the agent status page links back to the current QR control page.
- `POST /tasks` accepts JSON such as `{"action":"share","paths":["C:\\path\\file.txt"]}` or `{"action":"receive","paths":["C:\\path\\folder"]}`.
- `POST /stop-current` stops the active transfer task without exiting the long-lived agent.
- `POST /shutdown` stops the active task and cleanly exits the agent.
- `eqrcp desktop agent-stop` calls `/shutdown` so users can stop the long-lived agent without Task Manager.
- `eqrcp desktop agent-stop-current` calls `/stop-current` so users can cancel the active task from a shell without stopping the agent.
- `eqrcp desktop agent-status` fetches `/status` and prints a readable current task and recent history summary.
- `eqrcp desktop agent-open` opens the browser-based agent status page when the agent is running.
- `eqrcp desktop agent-open-current` opens the current task QR page when one is active.
- `eqrcp-launcher.exe` now tries to submit right-click `share` and `receive` tasks to the agent first.
- If the agent is not reachable, `eqrcp-launcher.exe` starts `eqrcp desktop agent`, waits for `/health`, then submits the task.
- If the agent is online and already waiting on a previous transfer, the new task is accepted and the agent stops the current server so the new QR page can open.
- If the agent cannot be started, the launcher falls back to the previous direct desktop command path.

Next priorities:

1. Validate QR completion cleanup, timestamped archive names, and original item lists in Windows right-click multi-file and directory share flows.
2. Validate the browser-based agent status page on Windows, including automatic status refresh, `eqrcp desktop agent-open`, `eqrcp desktop agent-open-current`, and the current task QR page link.
3. Validate the dedicated stop-current endpoint and `eqrcp desktop agent-stop-current` command so users can cancel the active transfer without exiting the agent.
4. Validate repeat QR scan and multi-browser behavior on Windows: completed or stopped one-shot links should return a clear expired response, while current state remains visible through `/qr/status`, `/status`, transfer-link `/status` aliases, and the agent status page.
5. Keep Windows process count bounded around one long-lived `eqrcp.exe desktop agent` plus short-lived launcher invocations.
6. Defer tray icon, startup registration, notifications, and persistent transfer history until the local agent lifecycle is stable.

## Recommended First Implementation

The first desktop implementation is available:

```sh
eqrcp desktop share <paths...>
eqrcp desktop receive [directory]
```

Use the browser QR page initially. It is already implemented and avoids introducing GUI dependencies. When `desktop receive` is launched from a right-click directory action, the clicked directory is passed explicitly. When it is launched manually without a directory, it falls back to the configured output directory or current working directory.

Then implement Windows and Linux installers. macOS can be documented first if no macOS environment is available for testing.

## Open Questions

- Should desktop mode always imply `--browser`?
- Should desktop mode suppress terminal QR output?
- Should failures use native notifications or open a browser error page first?
- Should `desktop receive` default to the clicked directory or the configured output directory when both are available?

## Risks

- File manager APIs differ significantly across platforms.
- Multi-select support is simple on Linux scripts but less simple with basic Windows registry entries.
- Desktop launches often have no terminal, so current stdout/stderr output may be invisible.
- First-run network interface selection may block or confuse desktop users.
- Antivirus or OS security policy may object to a binary that starts a local server.
