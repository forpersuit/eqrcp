# EQT 密码学与加密文档目录

本目录集中管理 **Chat 会话内容加密** 相关的现状核查、合理性分析与加密设计方案。  
整理基准日期：**2026-08-02**（代码版本 **v1.17.5**）。

---

## 文档清单

| 文档 | 状态 | 说明 |
| :--- | :---: | :--- |
| 本文件（README） | ✅ 分析结论 | Chat 会话内容加密**现状核查**、**合理性评估**、**问题与不足清单** |
| [resumable-e2ee-design.md](./resumable-e2ee-design.md) | 📘 设计提案（未落地） | AES-CTR 端到端加密 + 断点续传偏移对齐设计（**已修订密码学缺陷**，见文内 §5 修订说明） |
| [resumable-transfer.md](./resumable-transfer.md) | 📘 设计提案（未落地） | 分片断点续传传输机制（配套文档，非纯密码学） |

---

## 一、现状核查（第一性原理，代码事实）

Chat V2 的会话内容**当前没有任何内容级加密**，仅在传输层可选 TLS：

| 层 | 路径 | 承载内容 | 加密情况 |
| :--- | :--- | :--- | :--- |
| 控制面 | `/chat-v2/{token}/ws`（WebSocket） | 文本、presence、transfer 事件 | **明文 JSON**（`wsjson.Read` / `wsjson.Write`）；仅 `WSS` 时经 TLS |
| 数据面 | `/chat-v2/{token}/files/*`（HTTP） | 附件上传 / 下载 / ZIP | **明文 HTTP**；仅 `HTTPS` 时经 TLS |
| 历史 | `session.MessageStore`（进程内存） | 会话内全部消息 | 明文驻留 |
| 落盘 | 附件临时文件 / 接收文件 | 文件二进制 | 明文落盘 |

访问控制：**随机 URL token** 是唯一凭证。持 token 者即可加入会话、读取自 join 之后的全部历史、上传/下载附件。无设备级认证、无消息级完整性校验。

**配套事实**：`docs/resumable-e2ee-design.md` 与 `docs/resumable-transfer.md` 中的 `query_temp_size`、`/api/upload/chunk` 分片接口等**均未在代码中实现**——现行上传走 `/upload` 流式 multipart（`attachments.go` 的 `handleUpload`），下载走 `/files/{id}` 流式 HTTP。两份文档均为**设计提案**，不代表当前产品行为。

---

## 二、合理性评估

对一款"局域网、短命、token 门禁"的传输工具（qrcp 血统），**以明文 WebSocket/HTTP + 可选 TLS 作为基线是合理的**：

- 威胁模型为「局域网窃听者 / 意外分享链接」，随机 token 提供混淆，`--secure` 启用后 TLS 提供传输保密。
- `docs/security-notes.md` 已诚实声明边界：*Anyone who can reach the generated URL can download … random path reduces accidental discovery, but it is not a replacement for authentication.*

结论：**设计取舍本身成立**；问题在于①默认即明文、②无消息级认证、③将设计提案文档与现行行为混同。下文给出具体缺陷与修正。

---

## 三、现状的问题与不足

| # | 缺陷 | 影响 | 建议 |
| :--- | :--- | :--- | :--- |
| C1 | **默认明文传输**：未配置 `--secure` 时，文本与附件可被局域网嗅探 | 非受信 Wi-Fi 上机密泄露 | 文档明确"内容级加密未实现，仅传输层可选 TLS"；GUI 引导启用 HTTPS/WSS |
| C2 | **无消息级完整性/认证**：明文 HTTP 下 MITM 可篡改消息或附件而不被察觉 | 数据完整性无保障 | 至少引入传输层 TLS；若做内容级加密必须同时做认证（见下 §四） |
| C3 | **历史明文驻留内存、附件明文落盘** | 会话结束前可被本机进程读取；附件即明文文件 | 对短命本地传输可接受，文档如实标注即可 |
| C4 | **token 即全部凭证**：分享链接即分享会话访问权 | 误转发的链接可被他人加入并读取后续消息 | 维持现状但文档明示"加入后可见"边界；远期可加 join 确认/一次性 PIN |

---

## 四、对 AES-CTR E2EE 设计提案的密码学审查（摘要）

`resumable-e2ee-design.md` 的核心思路（客户端加密 → 服务端写入 `.tmp` → 断点处查询已写大小 N 并对齐 AES-CTR 计数器续传）**方向正确**，但原稿存在以下致命或高危缺陷，**已在本目录修订版中补齐**：

| # | 缺陷 | 严重度 | 修订措施 |
| :--- | :--- | :---: | :--- |
| E1 | **无密钥管理与协商**：全文未说明 AES 密钥来源、派生方式与共享信道 | 🔴 致命 | 从会话 token 经 HKDF 派生每会话密钥（token 即双方经 QR 已持有的共享秘密）；如需更强模型可评估 X25519 ECDH（与现行 HTTP 数据面冲突，另行设计） |
| E2 | **无认证/完整性**：AES-CTR 只提供机密性，可被翻转密文比特篡改明文 | 🔴 致命 | 采用 CTR+HMAC（Encrypt-then-MAC，分块 MAC）或 AES-GCM 分块 / XChaCha20-Poly1305，并指定 tag/MAC 落位 |
| E3 | **Nonce/IV 复用风险**：同 (key, counter 起点) 用于两份文件 → 密钥流复用 | 🔴 致命 | 每文件唯一 nonce，前置流首或由消息 ID 派生；counter 起点绝不重复 |
| E4 | **偏移→计数器换算不精确**："与计数器成正比"表述误导，未给块边界公式 | 🟠 高危 | 精确公式：块索引 `floor(N/16)`、丢弃块内前 `N mod 16` 字节；并明确 N 的度量空间 |
| E5 | **`.tmp` 明文/密文落位未定义**：决定 N 是明文长度还是密文长度 | 🟠 高危 | 明确"服务端写密文，`.tmp` 存密文，N 为密文字节数"（CTR 流式下两者等长，但必须显式声明） |
| E6 | **`query_temp_size` 通道无门禁/并发未定义** | 🟡 中 | 端点需 token 门禁；固定单写者或对临时文件写入位加锁 |
| E7 | **"E2EE" 命名过强**：token 派生密钥下，PC 即接收端点、持 token 者可解密，并非 Signal 式 E2EE | 🟡 中 | 修订威胁模型；与 `docs/pro/architecture-and-design.md` 的 WebRTC (DTLS-SRTP) 真 E2EE 交叉引用区分 |
| E8 | **无前向保密**：静态会话密钥，token 泄露即可解密整个会话 | 🟡 中 | 对短命本地传输可接受，文档标注为局限 |

完整修订见 [resumable-e2ee-design.md](./resumable-e2ee-design.md)。

---

## 五、交叉引用

| 文档 | 关系 |
| :--- | :--- |
| [`docs/security-notes.md`](../security-notes.md) | 全局安全模型与访问边界（本目录的现状依据） |
| [`docs/pro/architecture-and-design.md`](../pro/architecture-and-design.md) | Pro 档 WebRTC DataChannel（DTLS-1.2/1.3 + AES-GCM）真 E2EE 架构，与本目录提案的区别见 §四 E7 |
| [`docs/chat/README.md`](../chat/README.md) | Chat 模式总目录（Free 额度、交互修复、历史归档） |

---

## 修订记录

| 日期 | 说明 |
| :--- | :--- |
| 2026-08-02 | 建立 `docs/crypto/`；迁入 `resumable-e2ee-design.md` / `resumable-transfer.md`；新增会话加密现状核查与密码学审查 |
