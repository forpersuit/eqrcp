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
- Linux and macOS startup install/status/uninstall are implemented.
- Linux and macOS right-click install/status/uninstall remain platform-specific
  work and currently return a not implemented note outside Windows.

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

Cross-platform boundary:

- Startup integration can be mostly unified because each platform has a single
  common per-user mechanism: Windows Run key, freedesktop autostart, and macOS
  LaunchAgent.
- File-manager context menus are not "write once, adapt everywhere". Windows
  Explorer, GNOME Files/Nautilus, KDE Dolphin, and macOS Finder expose different
  extension points and packaging expectations.
- The portable layer should stay at `eqrcp desktop share/receive/status`; each
  OS adapter should only install or remove native entry points that call that
  stable command surface.

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
- `desktop status` now also reports desktop agent runtime diagnostics: whether the agent is running, its live version, current task, and whether the running agent should be restarted because it does not match the current executable.
- The agent status page now keeps the table responsive to the browser width and uses explicit expand/collapse controls for long `Paths` values instead of forcing permanently expanded rows.
- Windows manual validation: `desktop status` no longer misreports repaired entries as `needs repair` on localized Windows registry output.
- `desktop status` now prints a summary count for installed, needs-repair, and not-installed desktop integration entries.

### Phase 3: Better QR And Status UI

Status: in progress.

After the right-click workflow is functional, improve visibility:

- Dedicated QR window.
- Copy URL button. Implemented in the browser QR page.
- Stop server button. Implemented in the browser QR page.
- Transfer status. Implemented in the browser QR page through `/qr/events` server-sent events, with `/qr/status` polling as a fallback.
- Repeat transfer action. Implemented: the agent status page history and the original QR result page offer `Transfer again`; both create a new transfer task from the original action and paths instead of reusing the completed QR server.
- Transfer service status. Implemented: `/qr/status` returns the current QR transfer state, while `/status` returns service-level state with the current transfer and history.
- Transfer URL status alias. Implemented: appending `/status` to the active send or receive URL returns the current transfer state.
- Repeat scan handling. Implemented: completed or stopped one-shot transfer URLs now return `410 Gone` with a clear message instead of starting a confusing second transfer attempt.
- Completion cleanup. Implemented: when `/qr/status` reaches `completed`, `stopped`, or `failed`, the QR code, copy URL field, stop button, and waiting hint are hidden from the browser QR page.
- Archive clarity. Implemented: directory and multi-file downloads use timestamped zip names, and the browser QR page lists the original selected items while separately showing the zip archive name. The list title is rendered as a label, not as a transferred item.
- QR page purpose labels. Implemented: the page identifies share vs receive and shows the target file, archive, or output directory.
- Basic transfer progress. Implemented: `/qr/status` exposes byte counters and percent for browser display.
- Receive completion details. Implemented: `/qr/status` records the files saved during receive and the QR page displays them after upload.
- Mobile upload completion page. Implemented: after phone upload, the success page lists each saved file and uses a small mobile-friendly layout.
- Last used output directory. Partially implemented: `eqrcp desktop receive` can now run without a directory and uses the configured output directory or current working directory, while right-click receive still passes the clicked directory explicitly.
- System tray entry.

The first implementation stays browser-based to avoid adding GUI dependencies. `/qr` now opens an HTML control page, `/qr/image` serves the QR image, `/qr/events` pushes current transfer state changes, `/qr/status` returns the current transfer state for fallback polling, and `/qr/stop` stops the current transfer.

When the browser QR page is enabled, terminal one-shot transfers keep the server alive briefly after completion so the control page can show `completed`, `stopped`, or `failed` before the process exits. Completed, stopped, and failed one-shot transfer URLs remain terminal; repeat is handled by the long-running desktop agent.

Current progress model:

- Send progress counts bytes written by the server response and caps the UI at 100%.
- Receive progress counts bytes read from uploaded file parts and uses the request content length as the best available total.
- Browser range or parallel download requests may make send progress approximate, but the UI should remain monotonic and never exceed 100%.

Next priorities:

1. Validate progress, QR completion cleanup, timestamped archive names, and mobile upload completion pages in Windows right-click share and receive flows.
2. Validate `eqrcp desktop receive` without a directory, using the configured output directory or current working directory.
3. Validate setup repair checks for stale Windows registry paths, missing launcher placement, and the `desktop status` summary on Windows.

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
- `GET /` serves a browser-based agent status page with the current task, recent history, local stop actions, and `/events` server-sent events for near-real-time updates. `/status` polling remains as a fallback.
- Active agent tasks now include the browser QR page URL, and the agent status page links back to the current QR control page.
- Active agent tasks now also receive real server transfer state from the transfer service: `waiting`, `transferring`, `completed`, or `stopped`, including progress percentage, current file, and saved files.
- The agent browser page and `desktop agent-status` output now render `current file` and `saved files` explicitly for both the active task and history records, so Windows validation can confirm multi-file receive and large-transfer field updates without opening raw JSON.
- Send-side completion is based on response write progress: a transfer is completed only when the expected bytes are written without a write error. If the downloading client cancels before completion, the transfer is recorded as stopped instead of completed.
- Recent agent task history is persisted locally across agent restarts, capped at 20 records, and can be cleared from the agent status page or with `eqrcp desktop agent-history-clear`.
- `POST /tasks` accepts JSON such as `{"action":"share","paths":["C:\\path\\file.txt"]}` or `{"action":"receive","paths":["C:\\path\\folder"]}`.
- `DELETE /history` clears the in-memory and persisted recent task history.
- `POST /stop-current` stops the active transfer task without exiting the long-lived agent.
- `POST /shutdown` stops the active task and cleanly exits the agent.
- `eqrcp desktop agent-start` now exists as an explicit alias for `eqrcp desktop agent`, so users can start the long-lived agent with a clearer command name.
- `eqrcp desktop agent` and `eqrcp desktop agent-start` are foreground commands by default: they keep the shell occupied while the agent is running.
- `eqrcp desktop agent -B` and `eqrcp desktop agent-start -B` start the same agent in the background, wait for `/health`, print the status page URL and log path, then return control to the shell. The uppercase shorthand avoids conflicting with the existing global `-b` / `--browser` flag.
- `eqrcp desktop agent-stop` calls `/shutdown` so users can stop the long-lived agent without Task Manager.
- `eqrcp desktop agent-stop-current` calls `/stop-current` so users can cancel the active task from a shell without stopping the agent.
- `eqrcp desktop agent-status` fetches `/status` and prints a readable current task and recent history summary.
- The browser agent page now explains the task lifecycle directly: `Current` keeps the active task visible while its QR service still exists, and the task moves to `History` only after that service exits and the task is fully finalized.
- `eqrcp desktop agent-history-clear` clears recent desktop agent task history.
- `eqrcp desktop agent-open` opens the browser-based agent status page when the agent is running.
- `eqrcp desktop agent-open-current` opens the current task QR page when one is active.
- `eqrcp-launcher.exe` now tries to submit right-click `share` and `receive` tasks to the agent first.
- If the agent is not reachable, `eqrcp-launcher.exe` starts `eqrcp desktop agent`, waits for `/health`, then submits the task.
- If the agent is online and already waiting on a previous transfer, the new task is accepted and the agent stops the current server so the new QR page can open.
- If the agent cannot be started, the launcher falls back to the previous direct desktop command path.

Deferred Windows validation batch:

1. Validate QR completion cleanup, timestamped archive names, original item lists, large-send fields, and multi-file receive fields in Windows right-click flows.
2. Validate the browser-based agent status page on Windows, including automatic status refresh, `eqrcp desktop agent-open`, `eqrcp desktop agent-open-current`, and the current task QR page link.
3. Validate `eqrcp desktop agent-start -B`, `eqrcp desktop agent-stop`, and `eqrcp desktop status` runtime diagnostics on Windows, including the version mismatch `needs restart` case.
4. Validate `eqrcp desktop agent-stop-current`, repeat QR scan, multi-browser behavior, persisted history, and process count bounded around one long-lived agent plus short-lived launcher invocations.
5. Validate Windows startup registration, login autostart, startup repair detection, and lightweight notifications after the next Windows-focused development pass.

### Phase 5: Desktop Enhancements

Status: in progress.

These features should start after Phase 3 and Phase 4 validation are stable:

- Tray icon: expose status, open current QR page, stop current task, and stop agent from a small desktop surface.
- Startup registration: initial Windows current-user login startup is implemented with `eqrcp desktop startup-enable`, `eqrcp desktop startup-disable`, and `eqrcp desktop startup-status`. `eqrcp desktop status` also reports whether startup is disabled, enabled, or needs repair.
- Notifications: initial lightweight notifications are implemented for QR-ready, real transfer started, completed, failed, stopped, and replaced states. Real started/completed/stopped notifications are driven by server transfer state rather than only by agent task lifecycle. Windows uses built-in PowerShell/.NET balloon notifications without adding a GUI dependency.
- Persistent transfer history: initial bounded recent task persistence is implemented. Next refinements are configurable retention and optional history export/open-folder actions.
- Settings surface: initial browser-based settings surface is implemented on the local agent page. It can read and update output directory, interface, port, and browser-open preference through `/settings`, backed by the existing per-user config file. The browser-open preference is now used by desktop share/receive flows and desktop agent tasks.
- Interface selection is a dropdown populated from detected usable interfaces plus `any (0.0.0.0)`, so users do not need to know OS-specific adapter names.
- When no interface is configured, the settings page selects the first detected usable interface rather than `any`, because `any` can bind successfully while producing QR URLs that other devices cannot reach.
- Port `0` remains the recommended default because it lets the OS choose an available port. Fixed ports are supported for predictable URLs, but transfers fail visibly if the chosen port is already occupied.
- When no output directory is configured, desktop settings resolve to the current user's `Downloads` directory if it exists, otherwise the user's home directory. Saving an empty output value writes that resolved user-directory default instead of leaving receive behavior dependent on the process working directory.
- The config file stays in the current user's config directory. This remains the right default for installer builds because installation directories are often read-only, shared by multiple users, and unsuitable for mutable per-user preferences.
- The Wails GUI settings surface now exposes `Windows right-click share and receive` and `Start EQT at login` toggles. These wrap the existing `eqrcp desktop install/uninstall/status` and `startup-enable/startup-disable/startup-status` command paths instead of duplicating platform registry or autostart logic inside the GUI.
- Agent restart: the browser status page includes `Restart Agent`, which asks the current process to stop and launch a fresh background agent from the same executable.
- Transfer pages opened by the desktop agent now show a compact agent status pill in the top-right corner. It uses green, red, or gray state coloring for reachable, offline, and idle/restarting states. If the per-task QR service disappears after agent restart or replacement, the page falls back to the agent `/status` endpoint, shows whether the agent is reachable, and renders the task's final agent state when it can still find the task in current or history.
- Agent restart now synchronously finalizes the active task into persisted history before the old agent exits, so an already-open task page can still use `Transfer again` after the new agent starts.

Next priorities:

1. Build Windows binaries and run the deferred Windows validation batch, including the new GUI toggles for right-click integration and login startup.
2. Tighten tray semantics: distinguish closing the GUI from stopping the background agent, rename current-task actions so they also fit chat sessions, and disable unavailable tray actions when the agent is idle.
3. Improve notification backends without making notifications part of the transfer-critical path. Keep Linux/macOS on OS notification channels and prefer Windows Toast when packaging metadata makes it reliable, with the current balloon path as fallback.
4. Add history refinements: configurable retention and open/export actions for saved history.

### Phase 6: Cross-Platform Desktop GUI

Status: started.

Use Wails v2 to provide a native desktop application on Windows, Linux, and macOS while keeping the existing Go transfer engine and desktop agent as the source of truth. The user-facing product name is `EQT`, short for Easy QR Transfer; keep `eqrcp` as the CLI and core-transfer identity until a packaging and migration plan is ready.

Architecture:

- `desktop/gui` contains the Wails v2 app as a separate module.
- The GUI talks to the long-running desktop agent at `127.0.0.1:48176`.
- The GUI starts `eqrcp desktop agent-start -B` when the agent is offline, using `EQRCP_CLI`, a sibling `eqrcp` binary, or `eqrcp` on `PATH`.
- Transfer task creation stays behind the existing `/tasks` agent API.
- Settings stay behind the existing `/settings` agent API.
- The Wails app should not duplicate send, receive, status, history, or cleanup logic.

Initial GUI scope:

- Share mode opens as a drop-first workflow. The pending list and `Start transfer`
  / `Clear` actions appear only after files or folders are selected. Once the
  transfer starts, the workspace switches to QR/status and shows a locked list.
- Receive mode with output directory selection and a `Start receive` action.
- Current task display with state, target, QR page URL, and progress.
- Recent task history display.
- Stop-current action.
- Settings save for output directory and browser fallback.
- Settings are organized into product-facing sections for Network, System
  Integration, Chat, and Window. Integration controls use switch-style controls
  and status badges instead of exposing command-line terminology.
- Title-bar actions for settings, About, and feedback. The main workspace keeps
  settings out of the repeated transfer flow except for the receive directory.
- Native tray menu through `fyne.io/systray`. The first implementation keeps the
  tray as a control surface over the same Wails GUI and desktop agent actions:
  open app, share, receive, open current task, stop current task, settings,
  About, feedback, stop background service, and quit the GUI app.
- Chat mode through the desktop agent. The Wails app embeds the existing browser
  chat page in an iframe rather than maintaining a separate native chat
  implementation, so browser and GUI chat behavior stay identical.
- Native save bridge for chat attachments. The bridge validates the iframe
  source window, message origin, and attachment URL origin before invoking the
  desktop save dialog.

Commercial boundary:

- Keep the MIT-licensed transfer core compliant and attributed.
- Put paid value in desktop convenience features rather than in easily bypassed CLI primitives.
- Candidate paid features include tray automation, persistent advanced history, batch/task queues, auto-receive profiles, multi-device presets, organization deployment controls, and packaged support.
- Do not merge future upstream code whose license terms conflict with commercial distribution; keep the current MIT provenance and license notices.

Next priorities:

1. Finish native GUI validation on Windows first, because Windows right-click and Send To are the most mature desktop integration points in this repository. Include black-window regression checks for app launch, agent startup, settings toggles, and open-folder/open-file actions.
2. Validate OS notifications: Windows Toast with hidden fallback, Linux `notify-send`, and macOS system notification. Notification failures must stay non-fatal.
3. Validate tray behavior on Windows: startup, close-to-tray, right-click menu, current task action, stop-current action, stop background service, and GUI-only quit.
4. Refine tray state: disable unavailable actions, update tooltip text, and provide icon variants for idle, active, completed, and failed states.
5. Validate Wails chat on Windows with the shared browser UI: start chat,
   mobile scan, post-join synchronization, attachment upload, native save, and
   reconnect after background/foreground switching.
6. Render transfer QR/status natively inside the Wails window where it reduces
   dependency on browser control pages without duplicating chat UI.
7. Add packaging notes for Windows, Linux, and macOS, including required Wails platform dependencies and signing expectations.
8. Design paid-feature gates after the GUI workflow is stable enough that users can feel the value before encountering a paywall.

System tray note:

- Wails v2.12.0 does not expose a stable public `SystemTray` API in the same style as Wails v3 alpha.
- The local Wails v2 module contains internal and on-hold tray menu code, but no direct `options.App` or runtime entry point suitable for product use.
- Wails v3 alpha documents `app.SystemTray.New()` and tray menus; do not migrate only for tray support until v3 is stable enough for this product.
- The Wails v2 track now uses `fyne.io/systray` instead of Wails internal tray code.
  It requires cgo and needs explicit Windows, Linux, and macOS packaging checks.
- Linux tray visibility depends on a desktop StatusNotifier/AppIndicator watcher.
  Minimal sessions without that watcher may log a tray registration error while
  the GUI itself still runs.
- The tray plan, logo prompt, About surface, feedback surface, and paid-product gap list live in [EQT product roadmap](product-roadmap.md).

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
