# Windows Validation Checklist

This checklist is for the deferred Windows validation batch in `desktop-integration-plan.md`.

## Scope

- Validate Windows desktop integration behavior end-to-end.
- Produce pass/fail evidence for each item.
- Record findings before continuing new feature work.

## Environment And Build

- [ ] Use a clean test machine or VM with Windows Explorer enabled.
- [ ] Build binaries from current `master`:

```sh
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o /mnt/e/developer/results/eqt.exe .
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags -H=windowsgui -o /mnt/e/developer/results/eqt-launcher.exe ./cmd/eqt-launcher
```

- [ ] Place `eqt.exe` and `eqt-launcher.exe` side by side.
- [ ] Confirm CLI baseline:

```powershell
E:\developer\results\eqt.exe version
E:\developer\results\eqt.exe desktop --help
E:\developer\results\eqt.exe desktop status
```

Evidence to capture:

- Version output text.
- First `desktop status` output before install.

## Install And Baseline Regression

- [ ] Install desktop integration:

```powershell
E:\developer\results\eqt.exe desktop install
```

- [ ] Validate Explorer entries:
- [ ] `Share with eqt` on file right-click.
- [ ] `Share with eqt` on folder right-click.
- [ ] `Receive here with eqt` on folder right-click.
- [ ] `Receive here with eqt` on folder background right-click.
- [ ] `Send to > Share with eqt` exists.
- [ ] Validate no console prompt appears on right-click action.
- [ ] Validate right-click action opens browser QR page.
- [ ] Validate `desktop status` reports launcher path and no false localized parsing issues.

Evidence to capture:

- Screenshot for each context menu entry.
- One screenshot of QR page opened from Explorer.
- `desktop status` full output.

## Deferred Batch 1: QR/Transfer UI Details

- [ ] Right-click share file: validate progress, completion cleanup, final state.
- [ ] Right-click share directory: validate timestamped archive naming and original item list.
- [ ] Right-click share multi-select via Send To: validate item list and archive naming.
- [ ] Right-click receive: upload multiple files from phone and validate saved files rendering.
- [ ] Large send file: validate `bytesDone/bytesTotal/percent` behavior and monotonic UI.

Evidence to capture:

- QR page screenshots at waiting, transferring, completed/stopped.
- `/qr/status` sample JSON for one send and one receive.

## Deferred Batch 2: Agent Browser Status And Open Commands

- [ ] Start agent in background:

```powershell
E:\developer\results\eqt.exe desktop agent-start -B
```

- [ ] Open agent page and validate auto refresh and current/history sections:

```powershell
E:\developer\results\eqt.exe desktop agent-open
```

- [ ] Start a right-click task and validate `Open QR Page` link in agent page.
- [ ] Validate `agent-open-current` when active and when idle:

```powershell
E:\developer\results\eqt.exe desktop agent-open-current
```

Evidence to capture:

- Agent page screenshot with one active task.
- Agent page screenshot with history rows.
- Output of `desktop agent-status`.

## Deferred Batch 2.5: GUI Settings Toggles

- [ ] Open the Wails GUI settings panel.
- [ ] Confirm the settings panel is grouped into Network, System Integration, Chat, and Window without clipped text at the default window size.
- [ ] Enable `Windows right-click share and receive`.
- [ ] Confirm Explorer entries and `Send to > Share with eqt` are installed.
- [ ] Disable `Windows right-click share and receive`.
- [ ] Confirm Explorer entries and Send To script are removed.
- [ ] Enable `Start EQT at login`.
- [ ] Confirm `desktop startup-status` reports enabled.
- [ ] Disable `Start EQT at login`.
- [ ] Confirm `desktop startup-status` reports disabled.

Evidence to capture:

- Settings panel screenshot with each toggle state.
- `desktop status` output after enable and disable.
- `desktop startup-status` output after enable and disable.

## Deferred Batch 3: Background Lifecycle And Runtime Diagnostics

- [ ] Validate background start/stop path:

```powershell
E:\developer\results\eqt.exe desktop agent-start -B
E:\developer\results\eqt.exe desktop agent-status
E:\developer\results\eqt.exe desktop agent-stop
```

- [ ] Validate runtime diagnostics in `desktop status`:
- [ ] Agent not running case.
- [ ] Agent running with matching version case.
- [ ] Agent running with version mismatch case shows `needs restart`.

- [ ] Validate startup commands:

```powershell
E:\developer\results\eqt.exe desktop startup-status
E:\developer\results\eqt.exe desktop startup-enable
E:\developer\results\eqt.exe desktop startup-status
E:\developer\results\eqt.exe desktop startup-disable
E:\developer\results\eqt.exe desktop startup-status
```

Evidence to capture:

- Outputs for all commands above.
- `desktop status` output for each diagnostics case.

## Deferred Batch 4: Stop Current, Repeat Scan, Multi-Browser, History, Process Bound

- [ ] Start share task and stop it via CLI:

```powershell
E:\developer\results\eqt.exe desktop agent-stop-current
```

- [ ] Validate stopped task lands in history with expected state.
- [ ] Validate repeat behavior from:
- [ ] Original QR result page `Transfer again`.
- [ ] Agent history `Transfer again`.
- [ ] Validate multi-browser behavior on same task URL (no invalid state reset).
- [ ] Validate persisted history survives agent restart.
- [ ] Validate process count stays bounded around one long-lived agent plus short-lived launcher processes.
- [ ] Validate tray menu wording and behavior:
- [ ] `Open Current Task` works for active transfer or chat tasks.
- [ ] `Stop Current Task` stops the active transfer or chat task.
- [ ] `Stop Background Service` stops the agent without pretending it is a GUI-only quit.
- [ ] `Quit EQT App` exits the Wails app and tray shell.

Evidence to capture:

- `desktop agent-status` before/after stop and repeat.
- Task Manager or `Get-Process` snapshots during repeated right-click actions.

## Deferred Batch 5: Startup Autostart Repair And Notifications

- [ ] Enable startup and confirm current-user Run key registration.
- [ ] Sign out/sign in, confirm agent autostarts.
- [ ] Validate startup repair detection when executable path changes.
- [ ] Validate notifications for:
- [ ] QR ready.
- [ ] Transfer started.
- [ ] Completed.
- [ ] Failed.
- [ ] Stopped.
- [ ] Replaced.

Evidence to capture:

- `desktop status` and `startup-status` output after each startup state change.
- Screenshots or logs for notification events.

## Cleanup

- [ ] Uninstall desktop integration:

```powershell
E:\developer\results\eqt.exe desktop uninstall
```

- [ ] Confirm installed Explorer entries are removed.

## Result Template

Fill this table after execution:

| Area | Result | Notes | Evidence Path |
| --- | --- | --- | --- |
| Install and Explorer verbs | PASS/FAIL |  |  |
| Deferred batch 1 | PASS/FAIL |  |  |
| Deferred batch 2 | PASS/FAIL |  |  |
| Deferred batch 2.5 | PASS/FAIL |  |  |
| Deferred batch 3 | PASS/FAIL |  |  |
| Deferred batch 4 | PASS/FAIL |  |  |
| Deferred batch 5 | PASS/FAIL |  |  |
| Cleanup uninstall | PASS/FAIL |  |  |

If any item fails, create a follow-up issue with:

- Exact command or click path.
- Actual behavior.
- Expected behavior.
- Reproduction rate.
- Evidence link.
