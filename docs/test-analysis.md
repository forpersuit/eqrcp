# Test Analysis

This document records the current validation baseline for `eqrcp`. Keep it updated when desktop integration changes the way commands are launched.

## Baseline

The project currently builds and tests with Go 1.26.

```sh
GOCACHE=/tmp/eqrcp-go-build go test ./...
GOCACHE=/tmp/eqrcp-go-build go build ./...
```

Expected result:

- All package tests pass.
- The root package builds without producing a checked-in binary.

## CLI Checks

```sh
GOCACHE=/tmp/eqrcp-go-build go run . --help
GOCACHE=/tmp/eqrcp-go-build go run . receive --help
GOCACHE=/tmp/eqrcp-go-build go run . desktop --help
GOCACHE=/tmp/eqrcp-go-build go run . desktop share --help
GOCACHE=/tmp/eqrcp-go-build go run . desktop receive --help
GOCACHE=/tmp/eqrcp-go-build go run . version
```

Expected result:

- The command name is `eqrcp`.
- The default config path in help is `$XDG_CONFIG_HOME/eqrcp/config.yml`.
- Desktop helper commands are present.
- The version command prints `eqrcp dev [date: n/a]` for local development builds.

## Receive Flow

The receive flow was validated with a local loopback server and a multipart upload.

Server:

```sh
mkdir -p /tmp/eqrcp-recv-test
XDG_CONFIG_HOME=/tmp/eqrcp-config /tmp/eqrcp receive \
  -i any \
  --bind 127.0.0.1 \
  -p 19080 \
  --path recvtest \
  -o /tmp/eqrcp-recv-test
```

Client:

```sh
printf 'hello from upload test\n' > /tmp/eqrcp-upload.txt
curl -s -F 'files=@/tmp/eqrcp-upload.txt' \
  http://127.0.0.1:19080/receive/recvtest
```

Expected result:

- `/tmp/eqrcp-recv-test/eqrcp-upload.txt` exists.
- Its content matches the uploaded file.
- The server exits after the upload unless `--keep-alive` is set.

Observation:

- In non-TTY environments the keyboard listener may print `keyboard not detected`. This does not block transfer.
- Desktop launchers should avoid depending on interactive keyboard input.

## Send Flow

The send flow was validated with a local loopback server and a browser-like user agent.

Server:

```sh
printf 'hello from send test\n' > /tmp/eqrcp-send.txt
XDG_CONFIG_HOME=/tmp/eqrcp-config /tmp/eqrcp \
  -i any \
  --bind 127.0.0.1 \
  -p 19081 \
  --path sendtest \
  /tmp/eqrcp-send.txt
```

Client:

```sh
curl -s -A 'Mozilla/5.0' \
  -D /tmp/eqrcp-send.headers \
  -o /tmp/eqrcp-downloaded.txt \
  http://127.0.0.1:19081/send/sendtest
```

Expected result:

- `/tmp/eqrcp-downloaded.txt` matches `/tmp/eqrcp-send.txt`.
- Response headers include a `Content-Disposition` attachment filename.
- The server exits after transfer unless `--keep-alive` is set.

Observation:

- Send completion currently depends on a browser-style user agent path. Plain `curl` without a `Mozilla` user agent does not exercise the same shutdown path.

## Download Filename Checks

The send flow should preserve spaces in download filenames.

Single file with spaces:

```sh
printf 'space filename test\n' > '/tmp/my file final.txt'
XDG_CONFIG_HOME=/tmp/eqrcp-config /tmp/eqrcp \
  -i any \
  --bind 127.0.0.1 \
  -p 19281 \
  --path spacefile \
  '/tmp/my file final.txt'
```

Expected response header:

```text
Content-Disposition: attachment; filename="my file final.txt"; filename*=UTF-8''my%20file%20final.txt
```

Directory transfer:

```sh
XDG_CONFIG_HOME=/tmp/eqrcp-config /tmp/eqrcp \
  -i any \
  --bind 127.0.0.1 \
  -p 19282 \
  --path dirzip \
  '/tmp/eqrcp test dir'
```

Expected response header:

```text
Content-Disposition: attachment; filename="eqrcp test dir-directory.zip"; filename*=UTF-8''eqrcp%20test%20dir-directory.zip
```

Multiple file transfer:

```sh
XDG_CONFIG_HOME=/tmp/eqrcp-config /tmp/eqrcp \
  -i any \
  --bind 127.0.0.1 \
  -p 19283 \
  --path multizip \
  '/tmp/eqrcp one.txt' \
  '/tmp/eqrcp two.txt'
```

Expected response header:

```text
Content-Disposition: attachment; filename="eqrcp-multiple-files.zip"; filename*=UTF-8''eqrcp-multiple-files.zip
```

## Desktop Integration Test Requirements

Desktop integration should preserve the baseline above and add platform-specific checks:

- Context menu can share a selected file.
- Context menu can share a selected directory.
- Context menu can share multiple selected paths where the platform supports it.
- Context menu can receive into the selected directory.
- Manual `desktop receive` without a directory can receive into the configured output directory or current working directory.
- Launcher failures are visible to the user without requiring a terminal.
- Generated QR code is visible through a browser or dedicated window.
- Server exits after successful transfer by default.

## Desktop Command Checks

The desktop command surface was validated with:

```sh
GOCACHE=/tmp/eqrcp-go-build go run . desktop --help
GOCACHE=/tmp/eqrcp-go-build go run . desktop share --help
GOCACHE=/tmp/eqrcp-go-build go run . desktop receive --help
GOCACHE=/tmp/eqrcp-go-build go run . desktop share
GOCACHE=/tmp/eqrcp-go-build go run . desktop receive
GOCACHE=/tmp/eqrcp-go-build go run . desktop install
GOCACHE=/tmp/eqrcp-go-build go run . desktop status
GOCACHE=/tmp/eqrcp-go-build go run . desktop uninstall
```

Expected result:

- `desktop`, `desktop share`, and `desktop receive` help text is available.
- `desktop share` without paths fails with an argument validation error.
- `desktop receive` accepts an optional directory; without one it uses the configured output directory or current working directory.
- On non-Windows systems, `desktop install` and `desktop uninstall` fail with a platform not implemented error.
- On non-Windows systems, `desktop status` prints a platform not implemented status line.
- On Windows, `desktop install` should create Explorer context menu entries under `HKCU\Software\Classes`.
- On Windows, `desktop status` should report each expected registry entry and command.
- On Windows, `desktop status` should mark entries as `needs repair` when they point at an older executable path or when the Send To script differs from the current executable.
- On Windows, `desktop status` should show the expected `eqrcp-launcher.exe` path and explain the impact when the launcher is missing.
- On Windows, `desktop startup-enable` should register `eqrcp desktop agent` under the current-user Run key.
- On Windows, `desktop startup-disable` should remove that startup registration.
- On Windows, `desktop startup-status` should report disabled, enabled, or needs-repair startup state.
- On Windows, `desktop status` should include desktop agent startup state without treating disabled startup as a broken context-menu installation.
- On Windows, `desktop status` should include a summary count for installed, needs-repair, and not-installed entries.
- On Windows, `desktop uninstall` should remove those entries.

## Windows Desktop Install Manual Test

Build a Windows binary:

```sh
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o /mnt/e/developer/results/eqrcp.exe .
```

From Windows, run:

```powershell
E:\developer\results\eqrcp.exe desktop install
```

Expected result:

- File right click includes `Share with eqrcp`.
- Folder right click includes `Share with eqrcp`.
- Folder right click includes `Receive here with eqrcp`.
- Folder background right click includes `Receive here with eqrcp`.
- `Send to > Share with eqrcp` exists for multi-select sharing.
- Clicking a context menu entry does not show the Windows console-program prompt.
- Clicking a context menu entry opens the QR code page in the default browser.
- If `eqrcp-launcher.exe` is next to `eqrcp.exe`, `desktop status` reports it and installed commands use it.
- If `eqrcp.exe` exits with an error when started by `eqrcp-launcher.exe`, a Windows message box shows the failure and log path.

Then run:

```powershell
E:\developer\results\eqrcp.exe desktop uninstall
```

Expected result:

- The entries created by `desktop install` are removed.

## Windows Launcher Error Display

The no-console launcher should make failures visible even when Explorer starts it without a terminal.

Automated checks:

```sh
GOCACHE=/tmp/eqrcp-go-build go test ./cmd/eqrcp-launcher
```

Expected result:

- Missing `--eqrcp-exe` values return a clear launcher error.
- Formatted errors include the failed command.
- Formatted errors include the launcher log path.
- Formatted errors include the tail of the launcher log.

Manual Windows check:

```powershell
E:\developer\results\eqrcp-launcher.exe --eqrcp-exe E:\developer\results\eqrcp.exe share Z:\eqrcp-missing-file.txt
```

Expected result:

- A native Windows message box opens with title `eqrcp`.
- The message starts with `eqrcp failed:`.
- The message includes the command that failed.
- The message includes a `Log:` path under the user cache directory.
- The message includes the underlying `eqrcp` error in `Details:`.
- The message box stays visible until the user dismisses it.

Implementation note:

- The Windows launcher calls `user32.dll` `MessageBoxW` directly. It should not start PowerShell or show a transient console window for error display.
- Context menu tests must use a launcher named `eqrcp-launcher.exe` next to the main executable before running `desktop install`; otherwise the installer cannot register the no-console launcher path.

## Browser QR Control Page

Desktop share and receive commands open a browser page at `/qr`.

Expected result:

- `/qr` serves an HTML control page.
- `/qr/image` serves the QR code image.
- `/qr/status` serves the current transfer state as JSON.
- `/qr/events` streams the current transfer state with server-sent events so the QR page can update without waiting for a polling interval.
- `/status` serves service-level JSON with `current` transfer state and transfer `history`.
- Browser status pages and status JSON include the running eqrcp version so stale desktop agents can be identified during manual testing.
- Appending `/status` to the active transfer URL, such as `/send/<path>/status` or `/receive/<path>/status`, serves the current transfer state as JSON.
- Reopening a completed or stopped one-shot transfer URL returns `410 Gone` with a clear completion or stopped message.
- The page shows the transfer URL in a read-only input.
- The page identifies the QR purpose: share file, share directory, share multiple files, or receive files.
- For directory or multi-file shares, the page lists the original selected items and separately shows the timestamped zip archive name.
- The included-items label is rendered outside the file list, so it is not counted as a transferred item.
- The page has a `Copy URL` button.
- The page has a `Stop transfer` button.
- The page updates the displayed transfer state without refreshing.
- When the transfer reaches `completed` or `stopped`, the page hides the QR code, copy URL field, stop button, and waiting hint.
- The page displays byte progress when the server knows a total size.
- The page displays saved file paths after receive completes.
- Posting to `/qr/stop` stops the current server.

Automated checks:

```sh
GOCACHE=/tmp/eqrcp-go-build go test ./server
```

Expected result:

- The QR page template includes the image route, stop route, copy button, stop button, and escapes the transfer URL.
- The QR page template includes the completion cleanup wrapper, transfer item list title, saved-files title, and archive note.
- The transfer status helper stores and returns waiting, transferring, completed, and stopped states.
- Send metadata includes mode, title, target, archive metadata, original item names, total bytes, and percent.
- Receive metadata includes mode, title, target output directory, and percent.
- Receive completion metadata includes the actual saved file paths, including renamed paths when conflicts are resolved.

Black-box checks:

```sh
curl -s http://127.0.0.1:<port>/qr/status
curl -s http://127.0.0.1:<port>/status
curl -s -A Mozilla http://127.0.0.1:<port>/send/<path> -o downloaded.file
curl -s http://127.0.0.1:<port>/qr/status
curl -s -X POST http://127.0.0.1:<port>/qr/stop
```

Expected result:

- The initial status response contains `waiting`.
- The `/qr/status` response contains the current QR transfer state only.
- The `/status` response contains `current` and `history`.
- The transfer URL `/status` alias contains the current transfer state only and does not include service history.
- After a successful download, the status response contains `completed`.
- After a terminal transfer, repeat is available from both the desktop agent browser page history and the original QR result page. It posts to `/tasks/<id>/repeat` and starts a new transfer task instead of resetting the completed QR server.
- Interrupted transfers are recorded as `stopped`; server-side upload, disk, or rendering errors are recorded as `failed`; both states hide the original QR code.
- After a successful one-shot download, a later browser request to the same send URL returns `410 Gone` instead of resetting the transfer state.
- After a completed one-shot receive, a later browser request to the same receive URL returns `410 Gone`.
- Directory and multi-file downloads use timestamped zip file names, such as `eqrcp-multiple-files-YYYYMMDD-HHMMSS.zip`.
- During a large transfer, `/qr/status` contains `bytesDone`, `bytesTotal`, and `percent`.
- After receiving multiple files, `/qr/status` contains all saved file paths in `savedFiles`.
- Posting to `/qr/stop` stops the server.
- With the browser QR page enabled, successful one-shot transfers keep `/qr/status` available briefly after completion so the page can display `completed` before the process exits.

## Chat UI Checks

The chat surface is served by the Go template in `pages.Chat` and is reused by
the Wails desktop app through an iframe.

Expected result:

- Standalone browser chat opens as a self-contained session page with QR,
  copy URL, stop, message, attachment, and image preview controls.
- Embedded Wails chat detects iframe context and uses the desktop shell for
  status chrome, leaving the iframe focused on the message thread and composer.
- The message thread uses left/right bubbles, system messages, timestamps, and
  attachment cards without reserving an empty desktop side column.
- The composer stays visible by default, is styled as a chat input dock, and
  keeps unsent text in local browser storage so refreshes can restore drafts.
- On desktop pointer devices, message download/recall actions appear on
  hover/focus; on mobile/touch layouts, these actions remain visible.
- The composer disables empty sends, sends on Enter, preserves Shift+Enter for
  new lines, and uploads pasted clipboard files as attachments.
- The composer and message thread are separated by a stronger dock boundary so
  the input area reads like a chat control rather than a generic form.

Automated checks:

```sh
GOCACHE=/tmp/eqrcp-go-build go test ./server
```

Expected result:

- The chat template includes messaging, attachment, QR, stop, and reconnection
  routes.
- The chat template includes embedded iframe detection, Enter-key composer
  handling, pasted-file handling, draft restoration, and the disabled send
  button.

## Mobile Upload Completion Page

After a phone uploads files to a receive session, the browser response should make the result clear without needing the desktop QR page.

Expected result:

- The page title area says `Upload complete`.
- The page shows the number of files sent.
- Every saved file path appears as its own row.
- Long file names and paths wrap inside the viewport on mobile.
- The page tells the user that it is safe to close the page.

Automated checks:

```sh
GOCACHE=/tmp/eqrcp-go-build go test ./server
```

Expected result:

- The done-page template renders the completion title.
- The done-page template renders a multi-file count.
- The done-page template lists each transferred file separately.

## Desktop Agent

The desktop agent is the first step toward a single-instance desktop flow.

Command:

```sh
GOCACHE=/tmp/eqrcp-go-build go run . desktop agent
```

Expected result:

- The command starts a local HTTP control service at `127.0.0.1:48176`.
- `GET /health` returns success when the agent is alive.
- `GET /status` returns `idle` when no transfer is running.
- `GET /status` includes recent task history with `completed`, `failed`, or `replaced` states.
- `GET /events` streams agent status with server-sent events.
- `GET /` returns a browser status page with the current task, recent history, clear-history action, stop-current action, stop-agent action, and EventSource-based status updates with `/status` polling fallback.
- `GET /settings` returns editable desktop settings from the existing per-user config file, including detected interface options.
- `POST /settings` updates output directory, interface, port, and browser-open preference in the existing config file.
- Active tasks include the QR control page URL, and the browser status page links back to that QR page.
- Active tasks include real transfer state from the transfer service, including state, progress percentage, current file, and saved files.
- The browser agent page and `desktop agent-status` output explicitly show `current file` and `saved files` for the current task and history entries.
- Send transfers are marked completed only after the expected bytes are written without a response write error. Interrupted downloads are marked stopped.
- Recent task history is persisted across agent restarts and capped at 20 records.
- `POST /tasks` accepts one `share` or `receive` task.
- `DELETE /history` clears the in-memory and persisted recent task history.
- `POST /stop-current` stops the active task without stopping the agent.
- `POST /stop-current` returns a conflict when no task is active.
- While a task is active, later `POST /tasks` calls are accepted and cause the agent to stop the current task before running the next task.
- If the queue is full, `POST /tasks` returns `429 Too Many Requests`.
- `POST /shutdown` stops the active task and exits the agent.
- `POST /restart` stops the active task, shuts down the current agent, and starts a fresh background agent from the same executable.
- `eqrcp desktop agent-stop` calls `/shutdown` and prints `Desktop agent stopped.` on success.
- `eqrcp desktop agent-start` is available as an explicit alias for `eqrcp desktop agent`.
- `eqrcp desktop agent` and `eqrcp desktop agent-start` are foreground long-running commands by default; a normal shell should stay attached until the agent is stopped.
- `eqrcp desktop agent -B` and `eqrcp desktop agent-start -B` start the agent in the background, wait for `/health`, print the status page URL and log path, then return control to the shell.
- `eqrcp desktop agent-stop-current` calls `/stop-current` and prints `Current desktop agent task stopped.` on success.
- `eqrcp desktop agent-status` fetches `/status` and prints a readable current task and history summary.
- `eqrcp desktop agent-history-clear` calls `/history` and prints `Desktop agent history cleared.` on success.
- `eqrcp desktop status` and `eqrcp desktop startup-status` print the running eqrcp version before the status body.
- `eqrcp desktop status` also reports desktop agent runtime diagnostics, including whether the local agent is running, the live agent version, the active task, and whether the agent should be restarted because it does not match the current executable.
- `eqrcp desktop agent-open` opens the browser status page when the agent is running.
- `eqrcp desktop agent-open-current` opens the active task QR page when one exists.
- The agent keeps running after a task finishes and records the last task error if one occurred.
- The agent sends lightweight desktop notifications for QR-ready, real transfer started, completed, failed, stopped, and replaced states. Notification backend failures are ignored so transfers remain authoritative.

Automated checks:

```sh
GOCACHE=/tmp/eqrcp-go-build go test ./cmd
```

Expected result:

- Agent task validation rejects malformed actions.
- The agent accepts a valid task and runs it through the configured runner.
- The agent can stop the active task when a later right-click task arrives.
- The agent runs the accepted later task after the current task exits.
- The agent rejects new tasks only when the queue is full.
- The agent records completed and replaced tasks in status history.
- The transfer service emits status snapshots when state or progress changes.
- The transfer service tracks response write errors and incomplete send progress so canceled downloads do not appear as completed.
- The agent stores observed transfer state on the current task.
- The agent emits notification events for QR-ready, real transfer started, completed, failed, stopped, and replaced states.
- Real transfer notifications are deduplicated per task and transfer state.
- Notification messages summarize multiple selected paths as an item count.
- Notification backend errors do not update the transfer `last error`.
- The agent persists recent task history to the local config directory and reloads it after restart.
- The agent trims persisted recent task history to the configured limit and keeps new task IDs monotonic.
- The history-clear endpoint and command clear both in-memory and persisted history.
- The agent status formatter renders current task details and recent history.
- The agent status page renders the current task, recent history, lifecycle guidance for when a task remains in `Current` or moves into `History`, local clear/stop actions, EventSource updates, and fallback status polling.
- The agent status formatter and page both render `current file` and `saved files` when those fields are available from transfer snapshots.
- The browser agent page renders Stop Current on the active Current row instead of as a global header action.
- The browser agent page renders Restart Agent as an agent-level action.
- Long current file, saved files, and paths values stay one-line in tables with file/directory/archive visual treatment. The visible text uses the actual item name rather than the full path when possible. Clicking a value opens a stable detail dialog with a copy action.
- Desktop-agent QR pages include a top-right agent status pill, poll the agent `/status` endpoint, and keep showing agent reachability even after the task reaches `completed`, `stopped`, `failed`, or `replaced`.
- If the task QR service is unavailable after agent restart or task replacement, the QR page hides stale transfer controls, marks the transfer as disconnected, and uses agent current/history data to render the final task state when available.
- Restarting the agent while a task is active persists that task as `replaced` before shutdown; a newly started agent can reload it from history and accept `POST /tasks/<id>/repeat`.
- The settings endpoint reads and writes the existing per-user config file, validates interface choices against detected adapters or `any`, and the browser agent page renders the settings form with an interface dropdown.
- Empty output settings resolve to the current user's Downloads directory when it exists, otherwise the user's home directory.
- Desktop share, desktop receive, and desktop agent tasks use the saved browser-open preference, defaulting to browser pages for new configs.
- The failed transfer notification uses the transfer failure message when the server provides one.
- The browser agent page keeps the table responsive to viewport width and renders long `Paths` cells as collapsed blocks with explicit `Expand`/`Collapse` controls.
- The agent stores the current QR page URL and renders an `Open QR Page` link for the active task.
- The agent-open command checks `/health` and opens the local status page.
- The agent-open-current command opens the active QR page and reports idle state as an error.
- The agent-stop-current command records the active task as `stopped` and reports idle state as an error.
- The stop-current endpoint records the active task as `stopped`.
- The stop-current endpoint rejects idle stop requests with `409 Conflict`.
- The shutdown endpoint stops an active task and calls the configured server shutdown function.
- The Windows desktop status formatter reports `Desktop agent runtime: not running` when the local agent is offline and recommends `eqrcp desktop agent-start`.
- The Windows desktop status formatter reports `status: needs restart` when the running agent version differs from the current executable version.
- Running `eqrcp desktop agent runtime` should return guidance to use `desktop status` or `desktop agent-status` instead of trying to start a second foreground agent.
- The agent and agent-start commands expose `-B` / `--background`, and background startup uses the current executable, creates an agent log, waits for readiness, and reports the status URL.

## Launcher Agent Forwarding

The Windows launcher should prefer the desktop agent for right-click transfer actions.

Expected result:

- `eqrcp-launcher.exe --eqrcp-exe <path> share <file>` posts a `share` task to the agent when it is already running.
- `eqrcp-launcher.exe --eqrcp-exe <path> receive <directory>` posts a `receive` task to the agent when it is already running.
- If the agent is not running, the launcher starts `<path> desktop agent`, waits for `/health`, then posts the task.
- If the agent is busy, the launcher submits the task to the agent and does not start a second direct transfer.
- If the agent rejects a task, the launcher reports that rejection and does not start a second direct transfer.
- If the agent cannot be reached or started, the launcher falls back to the previous direct `eqrcp desktop share/receive` command path.
- Windows manual validation: a second right-click share replaces the first waiting share and opens the new QR flow instead of showing `desktop agent is busy` or doing nothing.

Automated checks:

```sh
GOCACHE=/tmp/eqrcp-go-build go test ./cmd/eqrcp-launcher
```

Expected result:

- Launcher arguments are converted to agent tasks only for `share` and `receive`.
- Agent task POST requests send the expected JSON payload.
- Agent rejection responses preserve the server message and use a distinct rejection error type.
- Agent busy responses are not expected in the normal replacement path, but rejection handling is kept for compatibility and queue-full errors.
- Agent health polling succeeds when `/health` returns `204`.

Manual Windows check:

```powershell
E:\developer\results\eqrcp.exe desktop install
```

Expected result:

- `eqrcp.exe desktop status` reports installed entries without false `needs repair` results on localized Windows output.
- First right-click share opens a QR page.
- A second right-click share replaces the first waiting transfer and opens the new QR page.
- `http://127.0.0.1:48176/` shows the long-lived agent state, current task, and recent history.
- The agent status page can stop the active transfer without exiting the agent.
- Process count should stay bounded around one long-lived `eqrcp.exe desktop agent` plus short-lived launcher invocations.

## Desktop Share Flow

The desktop share flow was validated by intercepting `xdg-open` with a temporary test script and downloading the shared file over loopback.

Test setup:

```sh
mkdir -p /tmp/eqrcp-fake-bin
cat >/tmp/eqrcp-fake-bin/xdg-open <<'SH'
#!/bin/sh
printf "%s\n" "$1" >> /tmp/eqrcp-opened-urls
exit 0
SH
chmod +x /tmp/eqrcp-fake-bin/xdg-open
```

Server:

```sh
printf 'desktop share download\n' > /tmp/eqrcp-desktop-share.txt
PATH=/tmp/eqrcp-fake-bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin \
XDG_CONFIG_HOME=/tmp/eqrcp-desktop-config \
/tmp/eqrcp-desktop-test desktop share \
  -i any \
  --bind 127.0.0.1 \
  -p 19181 \
  --path desktopshare \
  /tmp/eqrcp-desktop-share.txt
```

Client:

```sh
curl -s -A 'Mozilla/5.0' \
  -D /tmp/eqrcp-desktop-share.headers \
  -o /tmp/eqrcp-desktop-downloaded.txt \
  http://127.0.0.1:19181/send/desktopshare
```

Expected result:

- `/tmp/eqrcp-opened-urls` contains `http://127.0.0.1:19181/qr`.
- Downloaded content matches the source file.
- Response headers include an attachment filename.
- The server exits after the download.

## Desktop Receive Flow

The desktop receive flow was validated by intercepting `xdg-open` with the same fake browser script and uploading a file over loopback.

Server:

```sh
mkdir -p /tmp/eqrcp-desktop-recv2
PATH=/tmp/eqrcp-fake-bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin \
XDG_CONFIG_HOME=/tmp/eqrcp-desktop-config \
/tmp/eqrcp-desktop-test desktop receive \
  -i any \
  --bind 127.0.0.1 \
  -p 19182 \
  --path desktoprecv2 \
  /tmp/eqrcp-desktop-recv2
```

Client:

```sh
printf 'desktop receive second upload\n' > /tmp/eqrcp-desktop-upload2.txt
curl -s -F 'files=@/tmp/eqrcp-desktop-upload2.txt' \
  http://127.0.0.1:19182/receive/desktoprecv2
```

Expected result:

- `/tmp/eqrcp-opened-urls` contains `http://127.0.0.1:19182/qr`.
- `/tmp/eqrcp-desktop-recv2/eqrcp-desktop-upload2.txt` exists.
- Its content matches the uploaded file.
- The server exits after the upload.
