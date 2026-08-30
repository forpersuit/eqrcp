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

- **[正式发布清单 (Product Launch Checklist)](IMPORTANT_product-release.md)** — 上线前配置/口径/验收；下一版范围
- **[Paddle 商家 KYB 与合规开通指南](IMPORTANT_paddle-kyb-company-guide.md)** — 公司注册优势、KYB 认证、域名审核及出口结汇
- [Payment & Licensing System Docs (支付与授权系统文档)](payment/README.md)
- [Product Presentation & Merchant Compliance (支付合规页)](product-landing.md)
- [Auto-Update Design & Settings (自动更新设计)](IMPORTANT_auto-update-design.md)
- [Desktop integration plan](desktop-integration-plan.md)
- **[Chat 模式文档目录](chat/README.md)** — V2 现状、Free 额度、交互修复、历史归档
- **[密码学与加密文档目录](crypto/README.md)** — 传输与内容加密（Chat/Pro E2EE）、DRM 授权 Ed25519 签名与硬件指纹密码学规范
- [EQT product roadmap](product-roadmap.md)
- [Desktop platform notes](desktop-platform-notes.md)
- [Windows validation checklist](windows-validation-checklist.md)
- **[市场营销与全球推广全案目录 (Marketing Hub)](marketing/README.md)** — [全球 GTM 推广战略与 SEO/GEO 增长全案](marketing/global-gtm-and-seo-strategy.md) · [Twitter (X) 推广策略与推文库](marketing/twitter-promotion-strategy.md) · [核心功能短视频推广计划](marketing/feature-video-promotion-plan.md)
- **[未来功能设计 (Future Designs)](future/README.md)** — [Receive 模式移动端设备重命名与目录同步设计](future/20260831-receive-device-rename-and-sync-design.md)
- [Admin 文档目录](admin/README.md) · [Portal 文档目录](portal/README.md)

## License

MIT. See [LICENSE](../LICENSE).
