# eqt

`eqt` transfers files between a computer and a mobile device on the same local network by printing a QR code in the terminal.

This project is a fork of [`qrcp`](https://github.com/claudiodangelis/qrcp). The fork keeps the original local-transfer model while using its own Go module, command name, configuration directory, and environment variable prefix.

## Features

- Send a single file from the computer to a phone.
- Send multiple files or directories as a temporary zip archive.
- Receive files from a phone through a browser upload page.
- Receive pasted text as a `.txt` file.
- Receive pasted clipboard files and images from supported mobile browsers.
- Start a local LAN chat session with text and attachments.
- Manage active chat devices from the desktop host, including forcing a remote device offline.
- Choose a network interface, bind address, port, URL path, or FQDN.
- Use HTTPS with a supplied certificate and key.
- Use the EQT desktop app, tray menu, and Windows Explorer entries with a shared product icon.
- Generate shell completion for Bash, Zsh, Fish, and PowerShell.

## Build

Requires Go 1.26 or newer, matching the current `go.mod`.

```sh
go build ./...
```

Build a local binary:

```sh
go build -o eqt .
```

## Usage

Send a file:

```sh
eqt MyDocument.pdf
```

Send multiple files:

```sh
eqt MyDocument.pdf IMG0001.jpg
```

Send a directory:

```sh
eqt Documents/
```

Force zip mode:

```sh
eqt --zip LongVideo.avi
```

Receive files into the current directory:

```sh
eqt receive
```

Receive files into a specific directory:

```sh
eqt receive --output /tmp/dir
```

Start a local chat session:

```sh
eqt chat --browser
```

Run the configuration wizard:

```sh
eqt config
```

Desktop launcher helpers:

```sh
eqt desktop share /path/file.txt
eqt desktop receive /path/directory
eqt desktop chat
```

Experimental Wails desktop GUI:

```sh
cd desktop/gui
EQT_CLI=/path/to/eqt wails dev
```

The Wails chat view embeds the same browser chat UI used by `eqt chat`, so
desktop GUI and browser behavior stay aligned.

Desktop chat host controls:

- The device list shows online devices and connection status.
- The desktop host page can force a remote device offline from the expanded device details.
- Remote/mobile browser pages can inspect devices but cannot force another device offline.
- Image-copy actions are shown only when the current browser supports image clipboard writes; otherwise users should download or save the attachment.

On Windows, install user-level Explorer context menu entries:

```powershell
eqt.exe desktop install
eqt.exe desktop status
eqt.exe desktop uninstall
```

For multiple selected files on Windows, use `Send to > Share with eqt` after running `desktop install`.

For the smoothest Windows right-click experience, place `eqt-launcher.exe` next to `eqt.exe` before running `desktop install`.

When sharing a directory, the downloaded archive is named `<directory>-directory.zip`. When sharing multiple selected files, the downloaded archive is named `eqt-multiple-files.zip`.

## Configuration

The default configuration file is:

```text
~/.local/eqt/config.yml
```

On first use, EQT copies an existing legacy config from `$XDG_CONFIG_HOME/eqt/config.yml`,
`$XDG_CONFIG_HOME/eqt/config.yaml`, or `$XDG_CONFIG_HOME/eqt/config.json` into the new YAML path when possible.

Use a custom config file:

```sh
eqt --config /tmp/eqt.yml MyDocument.pdf
```

Useful flags:

- `--interface`, `-i`: network interface to bind to.
- `--bind`: explicit bind address, overriding interface selection.
- `--port`, `-p`: server port, with `0` meaning random.
- `--path`: URL path, with an empty value meaning random.
- `--output`, `-o`: receive destination directory.
- `--fqdn`, `-d`: hostname to place in generated URLs.
- `--keep-alive`, `-k`: keep the server running after a transfer.
- `--secure`, `-s`: use HTTPS.
- `--tls-cert`: TLS certificate path.
- `--tls-key`: TLS private key path.
- `--browser`, `-b`: open the QR code in a browser.
- `--reversed`, `-r`: reverse terminal QR code colors.

Environment variables use the `EQT_` prefix, for example:

```sh
EQT_INTERFACE=any
EQT_PORT=8080
EQT_KEEPALIVE=true
```

## Development

Run the test suite:

```sh
go test ./...
```

In restricted environments, set a writable Go build cache:

```sh
GOCACHE=/tmp/eqt-go-build go test ./...
```

For a one-step build of the current test artifacts, use:

```sh
scripts/build-artifacts.sh
```

Regenerate icon assets from the transparent square source and About brand source:

```sh
go run ./scripts/icon-assets docs/img/transparent.png docs/img/logo-design-horizontal.png
```

The generator writes Wails app icons, Windows `.ico`, tray/frontend logo marks, browser-page favicon/logo assets, and the appropriately sized About logo derived from `logo-design-horizontal.png`.

From WSL, push through the environment-aware helper:

```sh
scripts/git-push-smart.sh
```

The helper first checks direct `x.com` reachability. If direct access is unavailable, it pushes through the Windows host proxy on port `10808` using SSH `ProxyCommand`.

Planning documents:

- [Test analysis](docs/test-analysis.md)
- [Desktop integration plan](docs/desktop-integration-plan.md)
- [Chat mode development](docs/chat-mode-development.md)
- [Chat reconnection testing](docs/chat-reconnection-testing.md)
- [Desktop platform notes](docs/desktop-platform-notes.md)
- [Security notes](docs/security-notes.md)

## License

MIT. See [LICENSE](LICENSE).
