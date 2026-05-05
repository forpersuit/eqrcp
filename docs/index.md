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

Start a chat session:

```sh
eqrcp chat --browser
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

## Planning

- [Test analysis](test-analysis.md)
- [Desktop integration plan](desktop-integration-plan.md)
- [Chat mode development](chat-mode-development.md)
- [Chat reconnection testing](chat-reconnection-testing.md)
- [EQT product roadmap](product-roadmap.md)
- [Desktop platform notes](desktop-platform-notes.md)
- [Windows validation checklist](windows-validation-checklist.md)
- [Security notes](security-notes.md)

## License

MIT. See [LICENSE](../LICENSE).
