---
name: eqt-e2ee-review
description: Guides independent verification of EQT E2EE (end-to-end encryption) implementation claims in the docs/future tracker, guarding against self-referential test vectors, insecure-context (LAN HTTP) regressions, and silent DoD changes. Use when reviewing new commits on the feat/e2ee branch.
---

# EQT E2EE 实现审查验证指南 (E2EE Review & Verification Skill)

本技能用于审查 `feat/e2ee` 分支的新提交，独立验证 tracker `docs/future/20260901-e2ee-implementation-progress.md` 中开发者声称的实现进度，防止 DoD 静默降级或自引用测试向量。核心原则：**不信任文档声明，实测代码**。

---

## 1. 验证循环 (每轮审查的标准流程)

1. **读最新提交**：`git log --oneline -6` 确认审查对象，`git show <hash>` 看改动范围。
2. **读实现而非声明**：用 Read 读实际代码文件（crypto-engine.js / e2ee.go / session.ts / schema.sql），不要只信 tracker 的 ✅。
3. **独立交叉验证**（见 §2）：用第三方独立实现（Python/Go 标准库）算加密向量，与 JS 硬编码向量比对——**防止自引用向量**（JS 向量从旧实现算出，而非从标准实现算出）。
4. **跑测试**：`go test ./pkg/crypto/e2ee/... -v`（含 TestCrossLanguageInterop）+ `node pkg/crypto/e2ee/interop_test.js`（含 insecure-context 仿真 + 吞吐 benchmark）。
5. **模拟非安全上下文**（见 §3）。
6. **同步 tracker**：统一文档内部数字矛盾、补 timeline、更新 delta 表裁决状态。
7. **提交推送**：`./scripts/git-push-smart.sh origin feat/e2ee`（WSL 代理路由自动选择）。

## 2. 防自引用向量：独立交叉验证 (Cross-Verification)

HKDF 派生向量正确性**必须**由独立实现背书，不能只信测试文件内的硬编码 expected：

```bash
python3 -c "
import hashlib, hmac
def hkdf_extract(salt, ikm): return hmac.new(salt, ikm, hashlib.sha256).digest()
def hkdf_expand(prk, info, length):
    t=b''; okm=b''; i=1
    while len(okm)<length:
        t=hmac.new(prk, t+info+bytes([i]), hashlib.sha256).digest(); okm+=t; i+=1
    return okm[:length]
prk=hkdf_extract(bytes(32), bytes.fromhex('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'))
for l in ['eqt-e2ee-v2-send','eqt-e2ee-v2-recv','eqt-e2ee-v2-ws','eqt-e2ee-v2-auth']:
    print(l, hkdf_expand(prk, l.encode(), 32).hex())
"
```

- Go `hkdf.Extract(salt=nil)` 等价于 salt=32 零字节；HKDF-Expand L=32 只需 T(1)=HMAC(PRK, info||0x01)。
- libsodium 的 `crypto_auth_hmacsha256(message, key)` = HMAC-SHA256(key, message)，**参数顺序易错**（key 在后）。
- 比对 interop_test.js 中 `expectedKSend/KRecv/KWS/KAuth` 四个硬编码向量。

## 3. 非安全上下文仿真 (Insecure-Context Simulation)

LAN HTTP（`http://192.168.x.x`）下 `crypto.subtle` 与 `navigator.serviceWorker` 为 undefined。仿真方法：

```js
// 注意：不能直接赋值 global.crypto = {...}（non-writable getter 静默失败）
const origCrypto = global.crypto;
try {
  global.crypto = { getRandomValues: (arr) => origCrypto.getRandomValues(arr) }; // 无 subtle
  // ... init + encrypt/decrypt round-trip ...
} finally { global.crypto = origCrypto; }
```

若未来改用 `Object.defineProperty` 覆盖，需 `configurable: true`。曾实测：crypto.subtle 缺失时 `init()` 抛 `TypeError: Cannot read properties of undefined (reading 'importKey')`。

## 4. 关键文件与断言基线

| 文件 | 作用 | 关键断言 |
| :--- | :--- | :--- |
| `pkg/pages/assets/crypto-engine.js` | 前端引擎 | HKDF 不得引用 `crypto.subtle`（rg 校验）；密钥方向性：encryptChunk 默认 kSend / decryptChunk 默认 kRecv（用错 key 解密失败是**设计**，非 bug） |
| `pkg/pages/assets/libsodium.js` | WASM 运行时 | 481KB，wasm 内嵌无外部 `.wasm` 依赖 |
| `pkg/pages/assets/crypto.worker.js` | Worker 管道 | Transferable postMessage + 终止前 wipe |
| `pkg/crypto/e2ee/e2ee.go` | Go 引擎 | `golang.org/x/crypto/hkdf` + chacha20poly1305，AAD=fileID\|\|uint32_be(chunkIndex) |
| `pkg/crypto/e2ee/interop_test.js` | JS 全套测试 | 篡改向量 4 项 + insecure-context 仿真 + 吞吐 DoD ≥60MB/s；9ebbddc7 起断言改为检查 `err.code === AUTH_FAILED` / `retryable === false`（结构化 CryptoError） |
| `pkg/crypto/e2ee/cross_test.go` | Go↔JS 互通 | Go Encrypt→JS Decrypt（send 方向）+ JS Encrypt(recv)→Go Decrypt（RecvKey） |
| `cloudflare/eqt-drm-api/src/routes/session.ts` | DRM 端点 | Fail-Closed license、CAS claim、close changes===0→404 |
| `cloudflare/eqt-drm-api/schema.sql` | D1 表 | `e2ee_sessions` + `UNIQUE(device_id, mode)` |

**Chunk 信封**：`[ChunkIndex(4B BE) | Nonce(24B) | Ciphertext | Tag(16B)]`，AAD=fileID\|\|uint32_be(chunkIndex)。
**Packet 信封**：`[Nonce(24B) | Ciphertext | Tag(16B)]`，AAD=uint64_be(seq)。
**附件信封**：`[Nonce(24B) | Ciphertext | Tag(16B)]`（同 Packet 但无 4B 头），AAD=fileID 字节；`cross_test.go` **未覆盖附件**——审查附件互通时用临时 Go 测试内嵌 `node -e` 双向验证（Go Encrypt(kSend)→JS Decrypt + JS Encrypt(kRecv)→Go Decrypt），跑完即删。

## 5. 吞吐基准陷阱 (Throughput Benchmark Caveats)

- 单机基准随负载波动：多轮实测加密 182~197 MB/s / 解密 261~278 MB/s（`node interop_test.js` 基准）。
- tracker 内若出现多个不同的吞吐数字，需统一并标注测量轮次，避免文档内部矛盾。
- DoD 标准 ≥60 MB/s，任何低于此值的声称都要重新实测。

## 6. 常见陷阱总结

- **libsodium AEAD 解密失败是抛异常，不是返回 null**：`crypto_aead_xchacha20poly1305_ietf_decrypt` 验签失败抛 `Error("ciphertext cannot be decrypted using that key")`。9ebbddc7 起引擎统一 try/catch 转成 `CryptoError(AUTH_FAILED)`——审查时若篡改向量断言匹配失败，先确认断言是否已从 `/ciphertext cannot be decrypted/` 正则改为 `err.code === AUTH_FAILED`。
- **DoD 静默降级**：开发者把 DoD 要求替换成不同措辞（如把前端 JS 要求换成 Go 数字）。用 `git show <hash>~1:<file>` 恢复原始文本比对。
- **方向性密钥误解**：decryptChunk 默认 kRecv，benchmark 用 encrypt 生成的密文 + 默认 decrypt 会报 "ciphertext cannot be decrypted using that key"——需显式传 keyType='send'。
- **Node 模拟删除 crypto.subtle 失败**：直接赋值 global.crypto 静默失败，须用 finally 恢复原对象。
- **数字文档矛盾**：同一指标（如吞吐）在 Task 列表、DoD、delta 表三处数字不一致时，以实测为准统一。
- **防重放 seq 空间必须按发送者隔离**：若 `ReplayFilter` 为 Session 级共享而前端 `e2eeOutSeq` 每客户端实例从 1 起，房间内第二个客户端首条消息（seq=1）会被误判重放拒绝（D9，`c428455a` 复现：`duplicate packet seq 1 replayed`）。审查 E2EE 防重放实现时检查是否按 `(senderPeer, seq)` 分键。
- **seq 计数生命周期须与窗口生命周期匹配（D10 教训）**：即使按 peer 分键，若窗口会话级持久而前端 `e2eeOutSeq` 仅实例级（无 localStorage 持久化），同 peer 页面刷新/重进房间后新实例 seq 重置为 1 → 前 `旧maxSeq` 条被旧窗口误判重放**静默丢弃**（服务端仅 WARN 日志不返回错误）。审查时核对：前端 seq 计数是否持久化（`eqt_e2ee_seq_${token}` 类 localStorage）或服务端是否在 peer 替换时重建窗口。前端 `e2eeOutSeq` 类字段（如 `websocket.ts:584`）是典型风险信号。
- **三元运算优先级**：`(a.meta as any)?.changes ?? a.success ? 1 : 0` 中 `??` 优先级低于 `?:`，实际等价 `(changes ?? success) ? 1 : 0`；9ebbddc7 已修复为 `?? (a.success ? 1 : 0)`。审查 D1/SQL 类代码时留意同类表达式。
