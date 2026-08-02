# EQT 授权架构与防破解指南 (Licensing Architecture Overview)

> **📘 文档重构说明**：
>
> 本文档原有的密码学签名格式、硬件指纹算法与详细业务流程已统一收口清理至专业分类文档中，以消除重复维护与版本撕裂：
> 1. **密码学与签名规范**：移至 [`docs/crypto/drm-crypto-spec.md`](../crypto/drm-crypto-spec.md)（Ed25519 双层签名、3选2 SHA-256 硬件指纹算法、防篡改机制）。
> 2. **业务流程与运行时架构**：移至 [`docs/payment/drm-flow.md`](drm-flow.md)（激活、离线 7 天租约、在线对账、GUI 状态切换）。
> 3. **云端 Secret 与部署**：移至 [`docs/admin/IMPORTANT_drm-secrets.md`](../admin/IMPORTANT_drm-secrets.md)（Cloudflare Worker `eqt-drm-api` 环境变量与私钥配置）。

---

## 架构核心原则

1. **绝对不信任客户端状态**：客户端 `localStorage` 与本地 `chat_usage.json` 仅作为临时 UI 或免费额度计数，付费状态唯一可信源为由云端 Ed25519 私钥签名的数字证书 `~/.local/eqt/license.lic`。
2. **离线验签与在线对账双轨制**：
   - 离线状态下，客户端基于内置 Ed25519 公钥验证长期证书与 7 天内的对账租约签名。
   - 在线状态下，超过 12 小时后自动通过 `POST /api/v1/verify` 进行增量/全量对账同步。
3. **硬件指纹模糊匹配防空值**：采用主板 UUID、CPU 序列号、磁盘物理序列号进行 SHA-256 哈希，以 3 选 2 规则比对，且空值一律不计入匹配，防止越权。

详细技术细节与密码学算子请参阅上文关联文档。
