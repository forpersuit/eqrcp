# eqrcp

`eqrcp` transfers files between a computer and a mobile device on the same local network by printing a QR code in the terminal.

This project is a fork of [`qrcp`](https://github.com/claudiodangelis/qrcp). The fork keeps the original local-transfer model while using its own Go module, command name, configuration directory, and environment variable prefix.

## Features

- Send a single file from the computer to a phone.
- Send multiple files or directories as a temporary zip archive.
- Receive files from a phone through a browser upload page.
- Receive pasted text as a `.txt` file.
- Receive pasted clipboard files and images from supported mobile browsers.
- Start a local LAN chat session with text and attachments.
- Choose a network interface, bind address, port, URL path, or FQDN.
- Use HTTPS with a supplied certificate and key.
- Generate shell completion for Bash, Zsh, Fish, and PowerShell.

## Build

Requires Go 1.26 or newer, matching the current `go.mod`.

```sh
go build ./...
```

Build a local binary:

```sh
go build -o eqrcp .
```

## Usage

Send a file:

```sh
eqrcp MyDocument.pdf
```

Send multiple files:

```sh
eqrcp MyDocument.pdf IMG0001.jpg
```

Send a directory:

```sh
eqrcp Documents/
```

Force zip mode:

```sh
eqrcp --zip LongVideo.avi
```

Receive files into the current directory:

```sh
eqrcp receive
```

Receive files into a specific directory:

```sh
eqrcp receive --output /tmp/dir
```

Start a local chat session:

```sh
eqrcp chat --browser
```

Run the configuration wizard:

```sh
eqrcp config
```

Desktop launcher helpers:

```sh
eqrcp desktop share /path/file.txt
eqrcp desktop receive /path/directory
eqrcp desktop chat
```

Experimental Wails desktop GUI:

```sh
cd desktop/gui
EQRCP_CLI=/path/to/eqrcp wails dev
```

The Wails chat view embeds the same browser chat UI used by `eqrcp chat`, so
desktop GUI and browser behavior stay aligned.

On Windows, install user-level Explorer context menu entries:

```powershell
eqrcp.exe desktop install
eqrcp.exe desktop status
eqrcp.exe desktop uninstall
```

For multiple selected files on Windows, use `Send to > Share with eqrcp` after running `desktop install`.

For the smoothest Windows right-click experience, place `eqrcp-launcher.exe` next to `eqrcp.exe` before running `desktop install`.

When sharing a directory, the downloaded archive is named `<directory>-directory.zip`. When sharing multiple selected files, the downloaded archive is named `eqrcp-multiple-files.zip`.

## Configuration

The default configuration file is:

```text
$XDG_CONFIG_HOME/eqrcp/config.yml
```

Use a custom config file:

```sh
eqrcp --config /tmp/eqrcp.yml MyDocument.pdf
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

Environment variables use the `EQRCP_` prefix, for example:

```sh
EQRCP_INTERFACE=any
EQRCP_PORT=8080
EQRCP_KEEPALIVE=true
```

## Development

Run the test suite:

```sh
go test ./...
```

In restricted environments, set a writable Go build cache:

```sh
GOCACHE=/tmp/eqrcp-go-build go test ./...
```

For a one-step build of the current test artifacts, use:

```sh
scripts/build-artifacts.sh
```

Planning documents:

- [Test analysis](docs/test-analysis.md)
- [Desktop integration plan](docs/desktop-integration-plan.md)
- [Chat mode development](docs/chat-mode-development.md)
- [Chat reconnection testing](docs/chat-reconnection-testing.md)
- [Desktop platform notes](docs/desktop-platform-notes.md)
- [Security notes](docs/security-notes.md)

## License

MIT. See [LICENSE](LICENSE).
