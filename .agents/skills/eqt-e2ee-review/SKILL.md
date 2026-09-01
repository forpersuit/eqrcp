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
- **seq 计数生命周期须与窗口生命周期匹配（D10 教训）**：即使按 peer 分键，若窗口会话级持久而前端 `e2eeOutSeq` 仅实例级（无 localStorage 持久化），同 peer 页面刷新/重进房间后新实例 seq 重置为 1 → 前 `旧maxSeq` 条被旧窗口误判重放**静默丢弃**（服务端仅 WARN 日志不返回错误）。审查时核对：前端 seq 计数是否持久化（`eqt_e2ee_seq_${token}_${peer}` 类 localStorage）或服务端是否在 peer 替换时重建窗口。前端 `e2eeOutSeq` 类字段（如 `websocket.ts:584`）是典型风险信号。**已验证闭环方案（335cf3a1）**：① 前端 seq 持久化 + 恢复 `savedSeq+1`，`getNextE2EESeq()` 用 `Math.max(current+1, memSeq)`；② 服务端重放拦截返回 `REPLAY_DETECTED` 错误事件，前端 `+=1000` 前向校准；③ `isNewScan` 扫码注册时服务端按 peer 原子删窗口。**联合验证法**：临时 Go 测试把前端 seq 计数器逻辑（`Math.max` 恢复规则）× 服务端 `ReplayFilter` 串起来，模拟刷新后新实例 seq 断言全部 accepted（验后即删）。
- **三元运算优先级**：`(a.meta as any)?.changes ?? a.success ? 1 : 0` 中 `??` 优先级低于 `?:`，实际等价 `(changes ?? success) ? 1 : 0`；9ebbddc7 已修复为 `?? (a.success ? 1 : 0)`。审查 D1/SQL 类代码时留意同类表达式。
- **前端"已实现"声称 vs 模板实际改动（Phase 4 教训）**：tracker 声称"3 级流水线 + IndexedDB 落盘"已实现，实际 `upload.tmpl.html` / `download.tmpl.html` 只各加 2 行 `<script>` 引入 `libsodium.js` + `crypto-engine.js`，零业务逻辑（无 `crypto.worker.js`、无 Encrypt/POST/IndexedDB 调用）。审查前端特性时用 `rg -n "IndexedDB|Encrypt|/chunk|worker" pkg/pages/*.tmpl.html` 对比声称，勿把"引入引擎脚本"当成"已实现流水线"。**第 9 轮补充**：`ead22f1b` 起前端 E2EE 主链路真实落地（`upload.tmpl.html` +296 / `download.tmpl.html` +206，`EqtE2EEUploader`/`EqtE2EEDownloader` Pipeline 类、worker 加密、weak Wi-Fi 降级、chunk_status 续传）。此时验证重心从"是否存在"转向"声称的子项是否全部达成"——**"存储落盘"是高频注水点**：download 端 `decryptedChunks` 数组内存 Blob 拼接（`new Blob(decryptedChunks)`）≠ 原 Task 要求的 IndexedDB 流式落盘；iOS 1GB 边界若仅 `console.warn` 而无分片/落盘缓解，只能算"标注"不算"支持"。用 `rg -n "IndexedDB|indexedDB|decryptedChunks|new Blob"` 证伪。
- **接收端资源状态对象完成后必须清理（Phase 4 教训）**：`e2eeReceiveFile` 传输完成后残留 `e2eeReceiveFiles` map 且 `rf.File=nil`，导致同 `fileID` 二次上传命中 `rf.File == nil` 分支被误判为屏蔽返回 403（临时测试证实），且 completed 记录永不清理 → 内存增长。审查上传/下载链路时核对：完成（`Completed`）或取消（`Cancelled`）后资源是否从活动 map 移除。
- **无限重试循环（第 9 轮教训）**：前端重试逻辑若只有单一错误码（如仅 `403`）设 `retryable=false`，则 AUTH_FAILED（密钥错位/篡改）、网络错误、`AbortController` 超时等**全部走无限重试分支**（每 1s `setTimeout` 重排队列、无最大次数），密钥错位场景会永久卡死。审查时核对 `upload.tmpl.html` 类重试分支的 `retryable` 赋值覆盖了哪些错误路径；正确做法是 `400 AUTH_FAILED` 等确定性错误也应 `retryable=false`，或加最大重试次数。
- **E2EE 失败静默降级明文（第 9 轮教训）**：下载端 E2EE 链路任一 chunk 失败 → `catch → triggerNormalDownload()` 明文下载，用户无感知，违背端到端加密承诺（局域网明文走非安全信道）。审查时核对：E2EE 模式下失败是阻断提示还是静默 fallback；`meta` 响应若带 `is_e2ee` 标志，客户端是否校验后再走 E2EE 分支（`startE2EEDownload` 未校验 `metaData.is_e2ee` 是缺陷）。
- **服务端过期清理残留与锁粒度（第 9 轮教训）**：30 分钟过期清理若在 map lock 内仅 `v.File.Close()` + `delete(map)`，**不删除磁盘 `.tmp` 文件**（磁盘残留），且 close 未持 `rf.mu`（与活跃 `WriteAt` 存在理论竞争）、O(n) 全表扫描每请求执行。审查清理逻辑时核对：清理是否同时 `os.Remove(.tmp)`、是否在持有 per-file 锁下 close、是否避免在请求热路径做全表 scan。
- **前端模板 JS 语法验证（第 10 轮关键方法，能抓到回归）**：`go test`/`npm test` **完全不覆盖** `.tmpl.html` 内嵌 `<script>` 的 JS 语法。凡模板 JS 改动较大会有函数头误删/孤立 `}` 风险，必须做语法验证：抽取主 `<script>` 块（`src.index('<script>', src.index('libsodium.js'))` 定位）、用 Python 正则把 Go template 控制指令（`{{range/if ...}}`、`{{end}}`、`{{else}}`）替换为空、其余表达式（`{{.Count}}` 等）替换为 `0`，写临时文件后 `node --check`。**第 10 轮靠此法抓到 `77fe53e5` 误删 `triggerNormalDownload()` 函数头 → 裸顶层语句 + 孤立 `}` → 整个下载页 `<script>` 块 SyntaxError 全失效（D13）**。此方法应作为前端模板改动审查的**必做步骤**。
- **函数头丢失致整块 JS 失效（第 10 轮教训）**：`git show` 的 diff 在函数重组时可能静默删掉 `function xxx() {` 声明行，剩余函数体裸露为顶层语句，且孤立的 `}` 触发 SyntaxError——浏览器会丢弃整个 `<script>` 块（不止单函数）。症状：页面打开后功能全部无响应（文件列表/按钮/轮询全挂）。审查时若 diff 里函数被移动/重排，重点核对：每个 `function` 头是否配对、顶层是否有裸语句、`}` 是否孤立；再叠加 `node --check` 语法验证。
- **同名函数双定义后覆盖前（第 10 轮教训）**：重构时新增 Fail-Closed 版 `triggerDownloadItem`，但旧版（静默降级）未删除 → JS 提升后**后定义的旧版覆盖新版**，安全修复实际不生效。审查"新增修复版 + 旧版残留"场景时用 `rg -n "function triggerDownloadItem"` 数出现次数，同名函数超过 1 处必须深挖。
- **模板 JS 语法门禁已自动化，但独立复验仍不可省（第 11 轮教训）**：`aa718556` 起 `pkg/pages/pages_test.go` 新增 `TestTemplateJavaScriptSyntax`——用正则抽取四模板内联 `<script>`、把 Go template 指令替换为占位、base64 后经 `node vm.Script` 编译。但仍须保留我的独立 python 抽取 + `node --check` 双保险，原因：① 该测试 `node` 在 PATH 不存在时 `Skip`，CI 可静默跳过；② 其 sanitize 规则与独立方法有差异；③ 防自引用——测试与模板改动同属一次提交，可能同构错误。凡模板 JS 改动，两法都要跑。
- **safe-cleanup 测试五要素断言范式（第 11 轮）**：审查服务端过期清理/资源回收类逻辑时，可靠测试须逐一断言：① 阈值触发（注入 `CreatedAt` 超期对象）；② 锁粒度（map 锁外持 per-file `rf.mu` 关闭）；③ 句柄置 `nil`；④ 磁盘残留物理删除（`os.Remove(TempPath)`，且已完成文件**不**删）；⑤ `Cancelled`/状态位置位。`TestE2EEReceiveStaleCleanup` 即按此范式，可与实现逐条对表。
- **Settings 事件委托 matcher 遗漏（第 12 轮 Phase 5 教训）**：新增前端设置开关（如 `#settings-e2ee`）时，若仅在 HTML/渲染模板和 `syncSettingsFromDOM` 中定义，但漏了 `main.js` 中 `input` / `change` 全局事件委托 matchers 列表，会导致该开关在视觉上能滑动切换，却永远不触发 `syncSettingsFromDOM()` 与 `handleAutoSaveSettings()`，变成"死开关"。审查前端新增配置项时必须核对：`e.target.matches(...)` 选择器列表是否完整包含新增项。
- **Ban 封禁状态回显与全链路阻断（第 12 轮 Phase 5 教训）**：设计设备封禁（Ban/Unban）机制时需满足三要素：① 结构体回显：`ClientTransferStateInfo` 必须带 `isBanned` 字段并在 `copyClientStates`/`getClientStatus` 准确反射，前端才能正确渲染 `[🚫 已屏蔽]` 徽标与 `[✓ 恢复]` 解封按钮；② 跨链路阻断：不能只在 E2EE REST/WS handler 检查，传统 HTTP 上传/下载与 Tus 分块端点必须一律做 `s.IsClientBanned(clientID)` 403 阻断；③ 解封重置：Unban 后状态必须重置为 `waiting`，且后续分块连续游标 $M=0$ 允许重新上传。
- **CLI 探活外部服务快速降级与内存隔离（第 12 轮 Phase 5 教训）**：CLI 核心为离线局域网场景，启动探测公网 DRM 服务必须设置毫秒级超快超时（如 800ms），绝不可阻塞 5~10s 等待公网超时；高频查询（如状态轮询 snapshot）严禁每次读盘（`v.ReadInConfig`），必须使用内存缓存（`cachedEnableE2EE`）并在写入时刷新。
