# eqt

`eqt` transfers files between a computer and a mobile device on the same local network by printing a QR code in the terminal.

This project is a fork of [`qrcp`](https://github.com/claudiodangelis/qrcp).

## Usage

Send a file:

```sh
eqt MyDocument.pdf
```

Send a directory:

```sh
eqt Documents/
```

Receive files:

```sh
eqt receive
```

Start a chat session:

```sh
eqt chat --browser
```

Run the configuration wizard:

```sh
eqt config
```

## Configuration

The default configuration file is:

```text
~/.local/eqt/config.yml
```

Environment variables use the `EQT_` prefix.

## Planning & Docs

- [Payment & Licensing System Docs (支付与授权系统文档)](payment/README.md)
- [Product Presentation & Merchant Compliance (支付合规页)](product-landing.md)
- [Auto-Update Design & Settings (自动更新设计)](IMPORTANT_auto-update-design.md)
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
