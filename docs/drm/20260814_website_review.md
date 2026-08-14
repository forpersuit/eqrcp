# EQT 官网前端（eqt-website）逻辑与交互审查报告

> 审查日期：2026-08-14
> 审查方式：静态代码审查（只读，未改动任何源码）
> 审查范围：`cloudflare/eqt-website/` 下的 `index.html`、`pricing.html`、`portal.html`，以及支撑脚本 `js/api-base.js`、`js/checkout-verify.js`、`functions/_middleware.js`
> 交叉比对基准：`.agents/skills/eqt-drm/SKILL.md`（结账/门户规范）、后端 `cloudflare/eqt-drm-api/src/routes/{portal,checkout,paddle,auth}.ts` 与 `src/i18n.ts`（契约与多语文案）

---

## 0. 结论编号约定

| 系列 | 含义 |
|------|------|
| **W 系列** | 本次官网前端审查**新发现**的问题（W1–W12），每条附 `file:line` 证据链、触发路径、影响面与修复建议 |

本次为**只读审查**，聚焦「页面逻辑正确性 + 前后端契约对齐 + 交互一致性」，不涉及视觉样式优劣。

---

## 1. W1 —— 会话过期自动登出只对英/法文案生效（严重度：中高）

### 1.1 一句话结论

`portal.html` 用 `err.message.includes('Session')` 判断「会话过期并自动登出」。但后端 `session_expired` 文案是**按用户语言返回的翻译串**，只有英语（`"Session expired..."`）和法语（`"Session expirée..."`）里含有大写的 `Session` 子串；中文、日文、韩文、西班牙文、德文的会话过期文案**不含 `Session`**，导致这 5 种语言的用户会话过期后**不会触发 `handleLogout()`**，卡在一个空白的假 dashboard 上。

### 1.2 证据链（file:line）

- 前端判断：`cloudflare/eqt-website/portal.html:1108`
  ```js
  if (err.message.includes('Session')) {
      handleLogout();
  }
  ```
  该 `catch` 位于 `loadLicenses()`（`portal.html:1093-1111`），是会话过期的唯一自动登出兜底。

- 后端返回文案：`cloudflare/eqt-drm-api/src/i18n.ts:66-74`（`session_expired`），按 `reqLang` 返回：

  | 语言 | 文案 | 含 `Session`？ |
  |------|------|:---:|
  | en | `Session expired or invalid. Please sign in again.` | ✅ |
  | fr | `Session expirée ou invalide. Veuillez vous reconnecter.` | ✅ |
  | zh | `会话已过期，请重新获取验证码登录` | ❌ |
  | ja | `セッションの期限が切れました。再度ログインしてください。` | ❌ |
  | ko | `세션이 만료되었습니다. 다시 로그인해 주세요.` | ❌ |
  | es | `Sesión expirada o inválida. Inicie sesión de nuevo.` | ❌ |
  | de | `Sitzung abgelaufen oder ungültig. Bitte erneut anmelden.` | ❌ |

- 后端路由确有 `session_expired` 分支：`src/routes/portal.ts:99`（`GET /api/v1/user/licenses` 会话失效时返回 `getApiTranslation("session_expired", reqLang)`）。

### 1.3 触发路径 / 复现

```
用户（中文界面）登录 Portal → token 存入 localStorage（24h 过期，见 SKILL.md §6）
   → 24h 后重新打开 portal.html
   → checkSession() 盲目信任 localStorage token，直接进入 dashboard
   → loadLicenses() → GET /api/v1/user/licenses → 后端返回 401 { error: "会话已过期，请重新获取验证码登录" }
   → catch 分支：showToast(...) 弹出「错误：会话已过期...」
   → err.message.includes('Session') === false → 不调用 handleLogout()
   → 用户停留在 dashboard，但 licenses-container 为空/陈旧，且无「无授权码」提示
   → 用户误以为系统故障，只能手动清 localStorage 或点（若找得到）退出
```

### 1.4 影响

1. **核心受众（中文用户）直接踩坑**：本项目主要面向中文用户（SKILL 与文档均以中文为主），会话过期后的登出引导对中文界面**完全失效**。
2. 叠加 `checkSession()` 盲目信任 localStorage token 进入 dashboard，用户会看到「半残」界面而非被引导回登录页。
3. 后端还有 `unauthorized`（`i18n.ts:57-65`，英文 `"Unauthorized, please sign in again."`）分支，前端同样没有匹配 `Unauthorized`，进一步扩大失效范围。

### 1.5 修复建议

1. **不要用翻译文案做状态判断**。让后端在会话失效时返回**结构化的机器可读错误码**（如 `{ error_code: "SESSION_EXPIRED" }`），前端用 `data.error_code === 'SESSION_EXPIRED'` 分支，与语言彻底解耦。
2. 短期兜底：前端同时匹配 `session` / `会话` / `Sesión` / `Sitzung` / `セッション` / `세션` 等多语文案（不推荐，仅作过渡）。
3. 建议 `checkSession()` 进入 dashboard 前先做一次轻量校验（或首次 `loadLicenses` 401 时无条件 `handleLogout()`），而不是只对「特定文案」响应。

---

## 2. W2 —— 日文翻译串混入韩文（严重度：中）

### 2.1 一句话结论

`pricing.html` 的日文（`ja`）字典里，两条特性文案**混入了韩文字词**，日本用户会在定价卡上看到韩文。

### 2.2 证据链（file:line）

- `cloudflare/eqt-website/pricing.html:428`
  ```js
  "price_free_feat3": "最大5個 of 파일、단일 파일 최대 50MB",
  ```
  `파일`（韩文「文件」）与 `단일 파일 최대 50MB`（整段韩文）混入日文串。

- `cloudflare/eqt-website/pricing.html:442`
  ```js
  "price_yearly_feat2": "無制限의 세션 시간과 파일 수",
  ```
  `의`（韩文助词）与 `세션 시간과 파일 수`（韩文「会话时长与文件数」）混入。

对照正确韩文文案（`pricing.html:486/500`）与正确日文语义，上述两行是明显的跨语言粘贴污染。

### 2.3 影响

日本用户看到的定价页出现韩文片段，属本地化质量缺陷，直接损害专业形象与转化率。不影响业务逻辑。

### 2.4 修复建议

改为纯日文：`price_free_feat3` → `最大5ファイル、1ファイル最大50MB`；`price_yearly_feat2` → `セッション時間・ファイル数無制限`。

---

## 3. W3 —— 待生效升级提示仅 en/zh 有定义，5 语言回退英文（严重度：低中）

### 3.1 一句话结论

`portal.html` 中「年付→终身待生效升级」相关的三个提示键 `pending_upgrade_banner`、`upgrade_to_lifetime`、`upgrade_blocked_refund_window` **只在 `en` 和 `zh` 字典里定义**，日/韩/西/德/法 5 种语言的用户一旦有待生效升级（`pending_upgrade && effective_at`），会看到英文兜底文案。

### 3.2 证据链（file:line）

- 键定义仅两处：`portal.html:312-314`（en）、`portal.html:393-395`（zh）。
- 使用处（带英文兜底）：`portal.html:1212`
  ```js
  const bannerText = (dict.pending_upgrade_banner || "Lifetime pass purchased, effective on {date}").replace('{date}', effDateStr);
  ```
  及 `portal.html:1234/1236/1243`（`upgrade_blocked_refund_window` / `upgrade_to_lifetime` 同样 `|| '英文'` 兜底）。

- 后端确实存在该业务：`license_upgrades` 表 + `pending_upgrade` 字段（见 SKILL.md §5、`docs/drm/20260814_drm_review.md` 第 5 节）。

### 3.3 影响

非中英用户购买「终身升级（待当前年付到期后生效）」后，Portal 里的生效横幅与升级按钮文字显示英文，破坏本地化一致性。当前升级入口 `canUpgrade` 若为 false（功能暂缓），影响面暂时有限，但文案一旦启用即暴露。

### 3.4 修复建议

补齐 ja/ko/es/de/fr 三个键的翻译；并考虑为「缺失键」建立构建期断言（对比 7 语言的 key 集合是否一致），从机制上杜绝字典漂移。

---

## 4. W4 —— `verifyAndPay` 缺少单飞锁，自动验证与手动点击竞态（严重度：低中）

### 4.1 一句话结论

结账邮箱验证组件里，`sendCode()` 有 `isSending` 单飞锁防重入，但 `verifyAndPay()` **没有等价锁**。6 位验证码输入会自动触发（200ms 防抖）验证，同时「Verify & Proceed」按钮也可手动点击，两条路径在无互斥的情况下可能**并发发出两次 `verify-code` 请求**，甚至**双开 Paddle 收银台**。

### 4.2 证据链（file:line）

- `js/checkout-verify.js:96-106`（`onCodeInput`）：输入命中 `/^\d{6}$/` 后 `setTimeout(() => this.verifyAndPay(), 200)` 自动验证。
- `js/checkout-verify.js:83-86`：`payBtn` 点击也调用 `this.verifyAndPay()`。
- `js/checkout-verify.js:299-367`（`verifyAndPay`）：入口无 `isVerifying` 守卫；`316-318` 仅做 UI 层 `payBtn.disabled = true`，且 `finally`（`361-366`）会立即把按钮恢复为可用——**不是并发互斥**。
- 对照 `sendCode` 的正确写法：`js/checkout-verify.js:242` `if (this.isSending) return;`、`:249` `this.isSending = true`、`:276/279` 复位。

### 4.3 触发路径 / 复现

```
用户输入 6 位验证码 → onCodeInput 命中正则 → 200ms 后自动 verifyAndPay
   （200ms 窗口内）用户又点了「Verify & Proceed」按钮 → 第二个 verifyAndPay 进入
   → 两次并发 POST /api/v1/checkout/verify-code（同一个 code）
   → 若后端未严格单次消费，两次均返回成功 → 两次 close() + 两次 setTimeout 打开 Paddle.Checkout.open
   → 叠加两个收银台浮层
```

### 4.4 影响

1. 极端情况下双开 Paddle 收银台，用户困惑、可能误下单。
2. 即使后端做了验证码单次消费，第二次请求也会走 `catch` 分支在已关闭的弹窗上显示错误/摇动，产生不必要的网络请求与错误日志噪音。

### 4.5 修复建议

为 `verifyAndPay` 增加与 `sendCode` 同款的 `isVerifying` 单飞锁（进入即置 true，`finally` 复位）；并让自动验证与按钮点击共享同一互斥状态。

---

## 5. W5 —— localStorage 语言键分裂：`eqt_lang` vs `eqt-lang`（严重度：低）

### 5.1 一句话结论

Portal 用下划线键 `eqt_lang` / `eqt-page-lang` 读写语言偏好，而 `index.html` / `pricing.html` 用连字符键 `eqt-lang`。二者靠额外写入的 cookie `eqt-lang`（`portal.html:832`）兜底才勉强打通，但 localStorage 层键不一致。

### 5.2 证据链（file:line）

- `portal.html:816`：`localStorage.getItem('eqt_lang') || localStorage.getItem('eqt-page-lang')`
- `portal.html:830-831`：`localStorage.setItem('eqt_lang', lang); localStorage.setItem('eqt-page-lang', lang);`
- `portal.html:832`：`document.cookie = 'eqt-lang=...'`（额外写的 cookie）
- 对照 `pricing.html` / `index.html`：读写的 localStorage 键为 `eqt-lang`（连字符）。

### 5.3 影响

跨页语言能通过 cookie 兜底传递，但在「用户禁用/清除 cookie」或「无 cookie 环境（如某些 WebView）」下，Portal 与官网首页/定价页的语言偏好**各自独立**，用户反复切语言体验割裂。属一致性债，非现行故障。

### 5.4 修复建议

统一三个页面使用同一 localStorage 键（建议 `eqt-lang`），删除 `eqt_lang` / `eqt-page-lang` 冗余键。

---

## 6. W6 —— `renderLicenses` 用 innerHTML 直接注入服务端字段，未做 HTML 转义（严重度：低）

### 6.1 一句话结论

`portal.html` 的 `renderLicenses()` 用模板字符串拼 `innerHTML`，直接把 `license_code`、`revoke_reason`、`paddle_transaction_id`、`device_id`、`source` 等**来自服务端/Paddle 的字段**注入 DOM，全程无 `escapeHtml` 转义。当前数据源受控（码格式、Paddle 单号格式均固定），属**纵深防御缺口**而非现行 XSS。

### 6.2 证据链（file:line）

- `portal.html:1296-1316`（`card.innerHTML = ...`）：
  - `1299`：`${lic.license_code}`（`select-all` 展示）
  - `1300`：`data-code="${lic.license_code}"`（属性注入）
  - `1307`：`${sourceLabel}`（`sourceLabel = dict[sourceKey] || lic.source`，`1137-1138` 处 `lic.source` 可能原样回退）
  - `1313`：`${lic.revoke_reason}`（原样注入）
  - `1316`：`${lic.paddle_transaction_id}`
- 设备行 `portal.html:1185`：`act.device_id || act.uuid_hash.slice(0,12)` 作为 `data-device-id` 注入 `1193`。

### 6.3 影响

若未来任何一条写入路径让 `revoke_reason` / `source` / `paddle_transaction_id` 携带用户可控内容（例如把 Paddle 回传字段原样落库、或管理后台允许自定义原因），即可被 XSS 利用，进而窃取 `localStorage` 里的 session token（`eqt_portal_token`），扩大为账号接管。当前风险低，但 `renderLicenses` 是门户最核心的渲染函数，值得做防御性转义。

### 6.4 修复建议

引入统一的 `esc(str)` 转义函数，对所有注入 `innerHTML`/属性值的动态字段套用；或改用 `textContent` + `createElement` 组装（对齐 SKILL/项目「标准事件绑定 + 状态/模板分离」规范）。

---

## 7. W7 —— 内联 `onclick` 违反项目前端规范（严重度：低）

### 7.1 一句话结论

`pricing.html` 有两处内联 `onclick="..."`，违反 CLAUDE.md 前端最佳实践「严禁在 HTML 字符串中拼装内联全局 `onclick`，必须用 `addEventListener`」。

### 7.2 证据链（file:line）

- `cloudflare/eqt-website/pricing.html:1008`：`<button ... onclick="closeVerifyModal()">`
- `cloudflare/eqt-website/pricing.html:1062`：`<button ... onclick="closeModal()">`

（对照：`checkout-verify.js:89` 已经用 `addEventListener('click', ...)` 正确绑定了 `close-verify-modal-btn`，但 `pricing.html:1008` 的内联 `onclick` 与它重复/覆盖，是历史遗留。）

### 7.3 影响

内联 handler 依赖全局函数存在（`closeVerifyModal` 若被模块化拆分即失效），难以清理事件监听、调试可见性差，与代码库既定规范相悖。

### 7.4 修复建议

删除 `pricing.html:1008/1062` 的内联 `onclick`，改由 `checkout-verify.js` / 页面脚本统一 `addEventListener` 绑定。

---

## 8. W8 —— `isRateLimited` 用翻译文案做判断，脆弱（严重度：低）

### 8.1 一句话结论

`portal.html` 判断「发码是否被限流」用的是 `errMsg.includes('60')` 等字符串匹配，依赖后端翻译文案里恰好出现数字 `60`。虽然当前 7 语言 `rate_limited` 文案都含 `60`，但这是「以文案当契约」，任何文案改动（如把 60 秒改为 120 秒，或其它错误文案恰好含 `60`）都会误判。

### 8.2 证据链（file:line）

- `cloudflare/eqt-website/portal.html:1024`
  ```js
  const isRateLimited = errMsg.includes('60') || errMsg.includes('频繁') || errMsg.includes('frequent') || errMsg.includes('frecuente');
  ```
- 后端文案 `src/i18n.ts:102-109`（`rate_limited`）：zh/en/ja/ko/es/de/fr 均含 `60`，但这是巧合，非结构化契约。
- 误判后果：`portal.html:1033-1045` 若判定为限流则进入冷却分支（`1033` `if (!isRateLimited)` 为假时仅提示、不重置按钮）；若把「非限流错误」误判为限流，发码按钮会**停留在冷却态不恢复**。

### 8.3 影响

1. 文案改成非 60 秒后，限流提示失效（按钮不进入冷却，可被快速连点）。
2. 其它错误文案偶然含 `60`（如某错误含「HTTP 600」或「60 天」）会误入冷却分支，卡住发码按钮。

### 8.4 修复建议

与 W1 一致：后端返回结构化 `error_code`（如 `RATE_LIMITED`），前端按错误码分支，杜绝字符串匹配。

---

## 9. W9 —— `portal.html` 缺少 www 域名归一重定向（严重度：低）

### 9.1 一句话结论

`index.html` 与 `pricing.html` 顶部都有一段把非 `www.eqt.net.im` / 测试主机重定向到 `https://www.eqt.net.im` 的脚本，`portal.html` **没有**这段脚本，三个页面行为不一致。

### 9.2 证据链（file:line）

- 有重定向：`pricing.html:8-10`
  ```js
  var isTestHost = (h === 'test.eqt.net.im' || h === 'localhost' || h.startsWith('127.0.0.1'));
  if (!isTestHost && h !== 'www.eqt.net.im') { window.location.replace('https://www.eqt.net.im' + ...); }
  ```
  `index.html` 同样有（5-13）。
- 无重定向：`portal.html` 头部（`1-20` 行）直接进入 `<head>`，无任何 host 归一脚本。

### 9.3 影响

用户通过裸域 `eqt.net.im/portal.html` 或其它解析域名访问门户时不归一，可能造成品牌链接不统一、分享链接带非规范域名。纯一致性/规范化问题，无功能性故障。

### 9.4 修复建议

将 www 归一脚本抽为公共片段（`js/host-canonical.js`），三个页面统一引入，或在 `_redirects`/Pages 层面统一处理。

---

## 10. W10 —— 死代码 / 冗余声明（严重度：低）

### 10.1 一句话结论

`pricing.html` 内联脚本声明了 `let pendingPriceId` / `let verifiedEmail` 但从未使用；`openVerifyModal` 在页面内联脚本与 `checkout-verify.js`（`window.openVerifyModal`）中各定义一次，语义重叠。

### 10.2 证据链（file:line）

- `pricing.html:821-822`：`let pendingPriceId = null; let verifiedEmail = null;` —— 后续（`932-933`）实际读取的是 `window.checkoutVerifyComp.verifiedEmail`，这两个顶层变量是死代码。
- 页面内联 `function openVerifyModal(priceId)`（约 `870`）与 `checkout-verify.js` 的 `window.openVerifyModal` 双定义，二者都转发到 `checkoutVerifyComp.open()`。

### 10.3 影响

增加阅读负担、易造成「改了一处没改另一处」的漂移，无功能故障。

### 10.4 修复建议

删除 `pricing.html:821-822` 死变量；统一 `openVerifyModal` 单一来源（保留 `checkout-verify.js` 的全局绑定，删页面内联重复定义）。

---

## 11. W11 —— `verifyAndPay` 长度校验与 `onCodeInput` 正则不一致（严重度：低）

### 11.1 一句话结论

自动验证路径用严格正则 `/^\d{6}$/`，而 `verifyAndPay` 入口只校验 `code.length !== 6`，不校验「是否全数字」。手动点击时可用 6 位非数字码直接发出 `verify-code` 请求。

### 11.2 证据链（file:line）

- 自动：`js/checkout-verify.js:100` `if (/^\d{6}$/.test(code))`
- 手动入口：`js/checkout-verify.js:309` `if (!code || code.length !== 6)`

### 11.3 影响

后端会拒绝非数字码（返回错误），前端只是多一次无谓请求 + 错误提示；属校验不一致的健壮性瑕疵。

### 11.4 修复建议

`verifyAndPay` 的校验改为与 `onCodeInput` 一致的 `/^\d{6}$/`，统一「6 位纯数字」判定。

---

## 12. W12 —— 生产环境使用 Tailwind Play CDN（严重度：提示）

### 12.1 一句话结论

三个页面均在 `<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>` 上运行时生成样式（Play CDN），这是 Tailwind 官方**明确不建议用于生产**的方式。

### 12.2 证据链（file:line）

- `portal.html:16`、`pricing.html`、`index.html` 均引用 `cdn.tailwindcss.com?plugins=forms,container-queries`。

### 12.3 影响

1. 每次页面加载需在浏览器端即时编译，首屏样式有闪烁/延迟。
2. 引入对第三方 CDN 的运行时依赖与供应链面（该 CDN 与官方静态构建产物的安全边界不同）。

### 12.4 修复建议

生产构建改用 Tailwind CLI 编译出静态 CSS 并上传 Pages（若为纯静态页，可在构建期 `npx tailwindcss -o assets/app.css --minify`），去掉 Play CDN。

---

## 13. 严重度排序与修复优先级总表

| 优先级 | 编号 | 主题 | 严重度 | 位置 | 核心风险 |
|:---:|:---:|------|:---:|------|------|
| P0 | W1 | 会话过期自动登出仅对英/法文案生效 | 中高 | `portal.html:1108` vs `i18n.ts:66-74` | 中/日/韩/西/德用户过期后卡假 dashboard |
| P1 | W2 | 日文翻译串混入韩文 | 中 | `pricing.html:428/442` | 日本用户看到韩文，损害品牌 |
| P2 | W4 | `verifyAndPay` 无单飞锁 | 低中 | `checkout-verify.js:299-367` | 自动验证+点击竞态，可能双开收银台 |
| P2 | W3 | 待生效升级提示仅 en/zh 有 | 低中 | `portal.html:312-314/393-395` vs `1212` | 5 语言用户见英文横幅 |
| P3 | W6 | `renderLicenses` innerHTML 未转义 | 低 | `portal.html:1296-1316` | 纵深防御缺口，token 可被窃 |
| P3 | W8 | `isRateLimited` 文案字符串匹配 | 低 | `portal.html:1024` | 文案改动后限流/冷却判断失效 |
| P3 | W7 | 内联 `onclick` 违反规范 | 低 | `pricing.html:1008/1062` | 与既定前端规范相悖 |
| P3 | W5 | localStorage 语言键分裂 | 低 | `portal.html:816/830-832` | 无 cookie 环境下跨页语言割裂 |
| P3 | W9 | portal 缺 www 归一重定向 | 低 | `portal.html`（无）vs `pricing.html:8-10` | 域名不统一 |
| P3 | W10/W11 | 死代码 / 长度校验不一致 | 低 | `pricing.html:821-822`、`checkout-verify.js:309` | 健壮性/可维护性瑕疵 |
| P4 | W12 | 生产用 Tailwind Play CDN | 提示 | `portal.html:16` 等 | 首屏性能与供应链面 |

---

## 14. 修复建议汇总（按优先级）

1. **P0（W1）**：后端返回结构化 `error_code`（`SESSION_EXPIRED` / `RATE_LIMITED` 等），前端按错误码分支，彻底替换「翻译文案字符串匹配」这一反模式（同时覆盖 W1、W8）。
2. **P1（W2）**：修正 `pricing.html:428/442` 的日文文案为纯日文。
3. **P2（W4）**：为 `verifyAndPay` 加 `isVerifying` 单飞锁，与 `sendCode` 对齐。
4. **P2（W3）**：补齐 ja/ko/es/de/fr 的 `pending_upgrade_banner` / `upgrade_to_lifetime` / `upgrade_blocked_refund_window`，并建立「7 语言 key 集合一致」的构建期断言。
5. **P3（W6）**：`renderLicenses` 引入 `esc()` 转义或改用 `textContent` 组装。
6. **P3（W7/W5/W9/W10/W11）**：删除内联 `onclick`、统一语言键、补 portal www 重定向、清理死代码、统一 6 位数字校验。
7. **P4（W12）**：生产改静态 Tailwind 构建，去 Play CDN。

---

## 附录：审查方法与范围边界

- **方法**：逐文件静态审查 + 前端 ↔ 后端契约交叉比对（前端错误分支 ↔ `i18n.ts` 返回文案、结账/门户调用 ↔ `routes/*.ts` 端点），每条结论落到 `file:line`。
- **未覆盖**：未执行浏览器运行时/E2E 实测（可另用 `/chrome-test` 做响应式与交互走查）；Paddle 收银台的实际浮层行为、验证码单次消费的严格性以 Paddle 与后端运行态为准。
- **声明**：本次为只读审查，未修改任何源码；本报告即为交付物。
