# eqrcp

`eqrcp` transfers files between a computer and a mobile device on the same local network by printing a QR code in the terminal.

This project is a fork of [`qrcp`](https://github.com/claudiodangelis/qrcp).

## Usage

Send a file:

```sh
eqrcp MyDocument.pdf
```

Send a directory:

```sh
eqrcp Documents/
```

Receive files:

```sh
eqrcp receive
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

Environment variables use the `EQRCP_` prefix.

## License

MIT. See [LICENSE](../LICENSE).
