# eqrcp

`eqrcp` transfers files between a computer and a mobile device on the same local network by printing a QR code in the terminal.

This project is a fork of [`qrcp`](https://github.com/claudiodangelis/qrcp). The fork keeps the original local-transfer model while using its own Go module, command name, configuration directory, and environment variable prefix.

## Features

- Send a single file from the computer to a phone.
- Send multiple files or directories as a temporary zip archive.
- Receive files from a phone through a browser upload page.
- Receive pasted text as a `.txt` file.
- Receive pasted clipboard files and images from supported mobile browsers.
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

Run the configuration wizard:

```sh
eqrcp config
```

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

## License

MIT. See [LICENSE](LICENSE).
