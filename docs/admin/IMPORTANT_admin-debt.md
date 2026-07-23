# IMPORTANT — Admin 已知技术债与解决路径

> 基于 2026-07-23 生产实测与代码审查。  
> **主线 Admin v1 已可交付**；下列为剩余债，按优先级处理，避免 silent average。

关联：[progress.md](./progress.md) · [api-contract.md](./api-contract.md) · [IMPORTANT_admin-release.md](./IMPORTANT_admin-release.md)

---

## 1. 债项总表

| ID | 债 | 严重度 | 状态 | 建议解法 |
| :---: | :--- | :---: | :---: | :--- |
| D1 | 生产 error-log：`reqLang is not defined` | P1 | **未修** | 业务路径（非 Admin SPA）补 `reqLang` 定义/传参；修后健康/审计自然干净 |
| D2 | `PADDLE_API_KEY` 无效 → API 403 | P2 | **已缓解** | 探针已 `webhook_ok_api_key_invalid` 不整项失败；治本：换有效 key 或 `wrangler secret delete PADDLE_API_KEY` |
| D3 | 鉴权限流仅 **进程内** Map | P2 | 可接受 | 生产补 Cloudflare WAF / Rate limiting 规则（按 IP 对 `/api/v1/admin/*`） |
| D4 | 操作审计 `ctx.waitUntil` 异步 | P3 | 已知 UX | 文档已提示延迟刷新；可选改为 await 写入（略增延迟）或 UI 延迟 1s 再拉 |
| D5 | 解绑后客户端最长 ~7 天离线有效 | P2（产品） | 设计如此 | 文档/对客说明；急停需吊销 + 等 verify；非 Admin bug |
| D6 | 无多管理员身份 | P3 | 后置 | 单 secret 足够；若要多人：操作者 ID + 审计 `operator_id` + 独立凭证 |
| D7 | Webhook **成功**履约无时间线 | P3 | 后置 | 成功路径写 `admin_audit` 或独立 `webhook_events` 表，再给 Health 消费 |
| D8 | 反馈中心未接 `eqt-feedback-api` | P3 | 后置 | 独立 PR：跨域鉴权 + 只读列表 |
| D9 | `wrangler.toml` 含 SMTP/Paddle 明文 vars | P1（安全） | 存量 | 迁 `wrangler secret`；从 toml 删除明文；轮换密码 |
| D10 | `gap-analysis.md` 过时 | P2（文档） | **本次整理** | 标为历史快照；现状以 progress + IMPORTANT_* 为准 |
| D11 | 前端无自动化 E2E（仅 Chrome 手工/脚本） | P3 | 可选 | Playwright 登录 + 五 Tab 烟测挂 CI |
| D12 | R2 / 部分徽章仅 env 布尔 | P3 | 可接受 | 需要时再加 HEAD 探针 |

---

## 2. 优先解决路径（建议顺序）

### 第一优先（安全与脏数据）

1. **D9 Secret 迁出仓库配置**  
   - `MAIL_*`、`PADDLE_WEBHOOK_SECRET` 等改为 `wrangler secret put`  
   - 轮换已暴露在 git 历史中的口令  
   - 验收：toml 无敏感明文；生产发信/Webhook 仍正常  

2. **D1 `reqLang is not defined`**  
   - 在 `eqt-drm-api` 中定位抛错栈（error-log context_json / Worker log）  
   - 补全语言参数默认值（如 `extractRequestLang` 调用点）  
   - 验收：复现路径不再写 CRITICAL；可清空旧 log  

### 第二优先（生产加固）

3. **D3 边缘限流**  
   - CF Dashboard：Rate limiting rule on `lic.eqt.net.im/api/v1/admin/*`  
   - 与进程内 429 互补（多 isolate）  

4. **D2 Paddle API key**  
   - 有管理 API 需求：配置有效 `PADDLE_API_KEY`  
   - 仅需 Webhook：删除无效 key，探针回到 `webhook_secret_present`  

### 第三优先（产品增强，非阻塞）

5. D7 成功 Webhook 时间线 · D8 反馈中心 · D6 多管理员 · D11 SPA E2E  

### 产品/语义（勿当 bug 乱改）

6. **D5 七天离线租约**：改动影响已激活客户端安全模型，需单独 DRM 设计评审。

---

## 3. 明确「不是债」的已关闭项

下列曾为缺口，**2026-07-23 已关闭**，勿再当 open：

- Health FE/BE 字段错位（`paddle_configured` / `r2_configured`）  
- 假设备字段 / `ORDER BY licenses.id`  
- Admin 解绑非 `activation_id`  
- 无操作审计 API/UI  
- 无 SMTP/D1 真探针  
- 无进程内错 secret 限流  
- Overview 死链快捷入口  
- 契约与阶段 3 过滤/发码 email 文档滞后（api-contract 已同步）  

---

## 4. 关闭债时的 DoD

- 代码 + 测试（能自动化的上 `test:admin`）  
- 按 [IMPORTANT_admin-release.md](./IMPORTANT_admin-release.md) 部署  
- `progress.md` 技术债表勾选 + 验证记录一行  
- 若改契约：先改 `api-contract.md`  
