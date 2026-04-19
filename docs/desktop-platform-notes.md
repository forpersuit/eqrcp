# Desktop Platform Notes

This document records platform-specific integration approaches for right-click sharing.

## Windows

Status: implemented for user-level registry entries, pending manual validation in Windows Explorer.

### Minimal User-Level Registry Integration

File share entry:

```text
HKCU\Software\Classes\*\shell\eqrcp-share
HKCU\Software\Classes\*\shell\eqrcp-share\command
```

Command shape:

```text
"C:\Path\To\eqrcp.exe" desktop share "%1"
```

Directory share entry:

```text
HKCU\Software\Classes\Directory\shell\eqrcp-share
HKCU\Software\Classes\Directory\shell\eqrcp-share\command
```

Command shape:

```text
"C:\Path\To\eqrcp.exe" desktop share "%1"
```

Receive here entry for folder background:

```text
HKCU\Software\Classes\Directory\Background\shell\eqrcp-receive
HKCU\Software\Classes\Directory\Background\shell\eqrcp-receive\command
```

Command shape:

```text
"C:\Path\To\eqrcp.exe" desktop receive "%V"
```

Implemented entries:

- `HKCU\Software\Classes\*\shell\eqrcp-share`
- `HKCU\Software\Classes\Directory\shell\eqrcp-share`
- `HKCU\Software\Classes\Directory\shell\eqrcp-receive`
- `HKCU\Software\Classes\Directory\Background\shell\eqrcp-receive`

Install:

```powershell
eqrcp.exe desktop install
```

Status:

```powershell
eqrcp.exe desktop status
```

Uninstall:

```powershell
eqrcp.exe desktop uninstall
```

The installer uses the current `eqrcp.exe` path returned by the operating system, so install from the final binary location rather than from a temporary download path.

The Explorer command is launched through hidden PowerShell:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process ..."
```

This avoids Explorer showing the console-program prompt when a context menu entry starts `eqrcp.exe`.

After replacing `eqrcp.exe` with a newer build, run `eqrcp.exe desktop install` again to refresh the registered command path and launch command.

Pros:

- Simple.
- User-level install does not need administrator rights.
- Good enough for single selected files and folders.

Cons:

- Full multi-select behavior is limited with simple registry commands.
- Native shell extensions are more powerful but much more expensive to build and maintain.

Recommendation:

- Use registry integration for the first Windows version.
- Defer COM shell extension work until there is clear demand for polished multi-select behavior.

## macOS

Status: documented, not implemented.

Recommended first approach:

- Finder Quick Action or Services workflow.
- The workflow receives selected files or folders and invokes `eqrcp desktop share`.
- A separate workflow can receive into a selected folder.

Command shape:

```sh
/usr/local/bin/eqrcp desktop share "$@"
/usr/local/bin/eqrcp desktop receive "$1"
```

Pros:

- Uses system-provided Finder automation.
- No native extension needed for the first version.

Cons:

- Packaging, signing, Gatekeeper, and automation permissions affect user experience.
- Needs real macOS validation.

Recommendation:

- Document manual Quick Action setup first.
- Automate installation later if macOS testing is available.

## Linux

Status: documented, not implemented.

Linux needs multiple integrations because file managers differ.

### Nautilus

Scripts live in:

```text
~/.local/share/nautilus/scripts/
```

Nautilus exposes selected paths through environment variables such as:

```text
NAUTILUS_SCRIPT_SELECTED_FILE_PATHS
NAUTILUS_SCRIPT_CURRENT_URI
```

Share script command shape:

```sh
eqrcp desktop share "$@"
```

Receive script command shape:

```sh
eqrcp desktop receive "$PWD"
```

### KDE Dolphin

Service menus live in:

```text
~/.local/share/kio/servicemenus/
```

Use a `.desktop` service menu that calls:

```sh
eqrcp desktop share %F
eqrcp desktop receive %f
```

### Thunar

Thunar custom actions are usually configured through the UI. The project can provide documentation first and automate later if needed.

Recommendation:

- Implement Nautilus first.
- Add KDE service menu next.
- Document Thunar setup.

## Cross-Platform Install Command

Future command:

```sh
eqrcp desktop install
eqrcp desktop uninstall
```

Expected behavior:

- Install only for the current user by default.
- Print installed file or registry locations.
- Do not overwrite unrelated user customizations.
- Uninstall only entries created by `eqrcp`.

## Cross-Platform Launch Concerns

Desktop launches usually do not provide a useful terminal. Desktop commands should:

- Open a QR view automatically.
- Surface errors visibly.
- Avoid blocking on interactive prompts.
- Prefer already configured network settings.
- Provide a clear failure if no usable network interface is found.
