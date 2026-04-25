# eqrcp Desktop GUI

This is the Wails v2 desktop application for `eqrcp`.

The GUI is intentionally thin. It talks to the existing desktop agent at `127.0.0.1:48176` and does not reimplement transfer logic. If the agent is not running, the GUI tries to start `eqrcp desktop agent-start -B` by finding the CLI in this order:

1. `EQRCP_CLI`
2. An `eqrcp` or `eqrcp.exe` binary next to the GUI executable
3. `eqrcp` on `PATH`

## Development

Install Wails v2:

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
```

Install frontend dependencies:

```sh
cd desktop/gui/frontend
npm install
```

Run frontend checks:

```sh
cd desktop/gui/frontend
npm run build
```

Run Go checks:

```sh
cd desktop/gui
GOCACHE=/tmp/eqrcp-go-build go test ./...
```

Run the GUI in development mode:

```sh
cd desktop/gui
EQRCP_CLI=/path/to/eqrcp wails dev
```

Linux development requires the Wails system dependencies reported by `wails doctor`, especially `pkg-config`, `libgtk-3-dev`, and `libwebkit2gtk-4.0-dev`.

## Current Scope

- Share workspace with file/folder selection and Wails file-drop support.
- Receive workspace with output directory selection.
- Agent status, current task, progress, and recent history display.
- Stop-current action.
- Settings save for receive output and browser fallback.

## Deferred

- Native tray menu.
- Native QR rendering inside the GUI instead of linking through the existing task state.
- Paid feature gating and license activation.
- Native package metadata, signing, and installer polish.
