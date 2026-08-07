# EQT 环境操作手册(测试 / 生产对照执行)

> 本手册是**测试与生产执行的一站式对照**。所有操作先查 §2 与 §3,再动手。
> 目的是让测试/生产的差别一眼看清,杜绝混淆、误操作、污染。
>
> 最后更新:2026-08-07
>
> 关联文档:[部署流水线总览](./README.md)、[测试环境搭建](./test-environment.md)、[GUI 环境开关](./gui-environment.md)

---

## 1. 一句话隔离原则

- **测试与生产完全隔离**:资源、域名、密钥、构建、部署互不共享。
- **判据(记牢这三条)**:
  1. 资源名带 `-test` 后缀(worker/d1/r2)或走 `workers.dev` 子域 → 测试;自定义域名(lic./feedback./www.)→ 生产。
  2. Paddle 密钥以 `pdl_sdbx_` 开头 → 沙箱/测试;`pdl_live_` → 生产。
  3. GUI 构建不带 `-tags eqtdev` → 生产;**带 `-tags eqtdev` → 测试**。
- **漏配方向永远安全**:wrangler 命令不带 `--env test` → 默认生产;release 构建不带 tag → 恒生产。所以误操作多半是"本该测试却执行成了生产",操作前必查 §6 清单。

---

## 2. 环境对照总表

| 维度 | 🟢 生产 | 🟡 测试 |
|---|---|---|
| DRM API 域名 | `lic.eqt.net.im` | `eqt-drm-api-test.leeyelon.workers.dev` |
| Feedback 域名 | `feedback.eqt.net.im` | `eqt-feedback-api-test.leeyelon.workers.dev` |
| 更新元数据 | `lic.eqt.net.im/update-metadata.json` | 测试 Worker 同名路径(返回生产版本号,仅验证逻辑) |
| Worker 名 | `eqt-drm-api` / `eqt-feedback-api` | `eqt-drm-api-test` / `eqt-feedback-api-test` |
| D1 库 | `eqt-drm-db` / `eqt-feedback-db` | `eqt-drm-db-test` / `eqt-feedback-db-test` |
| R2 桶 | `eqt-crash-reports` / `eqt-feedback-bucket` / `eqt-downloads` | `eqt-crash-reports-test` / `eqt-feedback-bucket-test` |
| Paddle 密钥 | live(`pdl_live_`,激活码 `source='purchase'`) | sandbox(`pdl_sdbx_`,激活码 `source='test'`) |
| ED25519 签名密钥 | 生产私钥 seed(公钥 `08443678...`) | 测试专用 seed `2cf5baa8...`(公钥 `ce07f0...`) |
| GUI 构建 | `wails build`(无 tag,恒生产) | `wails dev / build -tags eqtdev` |
| 部署流水线 | master push + 审批(`deploy.yml`) | dev 分支 push,无审批(`deploy-test.yml`) |
| 下载分发 | `download.eqt.net.im`(R2) | 无(测试不建分发桶) |
| 崩溃上报 | `lic.eqt.net.im/api/v1/crash-report` | 测试 Worker 同名路径 |
| 数据语义 | 真实用户、真实交易 | 沙箱交易、探针、一次性测试码 |

---

## 3. 执行方式对照(同一操作,测试 / 生产分别怎么做)

> 所有命令在 `cloudflare/<项目>/` 目录下执行。**`--env test` 缺失 = 生产!**

| 操作 | 🟢 生产 | 🟡 测试 |
|---|---|---|
| 部署 DRM Worker | `npx wrangler deploy` | `npx wrangler deploy --env test` |
| 部署 Feedback Worker | `npx wrangler deploy` | `npx wrangler deploy --env test` |
| 部署前干跑验证 | `npx wrangler deploy --dry-run` | `npx wrangler deploy --env test --dry-run`(确认 routes 为空) |
| 配置 secret | `echo -n '<值>' \| npx wrangler secret put <KEY>` | `echo -n '<值>' \| npx wrangler secret put <KEY> --env test` |
| 查看 secret 列表 | `npx wrangler secret list` | `npx wrangler secret list --env test` |
| 执行 D1 SQL | `npx wrangler d1 execute eqt-drm-db --remote --command "..."` | `npx wrangler d1 execute eqt-drm-db-test --remote --command "..."` |
| 初始化 D1 schema | `npx wrangler d1 execute eqt-drm-db --remote --file=schema.sql` | `npx wrangler d1 execute eqt-drm-db-test --remote --file=schema.sql` |
| D1 备份 | 每日自动(`d1-backup.yml`);`wrangler d1 backup create eqt-drm-db --remote` | 无备份(可随时重建) |
| 健康检查 | `curl https://lic.eqt.net.im/api/v1/health` | `curl https://eqt-drm-api-test.leeyelon.workers.dev/api/v1/health` |
| 构建 GUI(开发连测试) | — | `cd desktop/gui && wails dev -tags eqtdev` |
| 构建 GUI(打包测试版) | — | `cd desktop/gui && wails build -clean -tags eqtdev -platform windows/amd64` |
| 构建 GUI(发布版) | `wails build -clean -platform windows/amd64`(release.yml 自动) | — |
| 部署网站/admin | `npx wrangler pages deploy ...`(仅生产) | 测试站未建,直连生产(admin 恒生产) |
| 打 tag 发布 | `git tag vX.Y.Z && git push --tags`(仅生产) | — |

---

## 4. 如何测试(测试环境执行手册)

> 前提:测试环境已按 [test-environment.md](./test-environment.md) 搭建完毕(测试 Worker 已部署、secrets 已配、ED25519 为 hex seed)。

### 4.1 API 级测试(激活/验证签名链路)

```bash
# ① 插入探针 license(测试库)
CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db-test --remote \
  --command "INSERT INTO licenses (license_code, tier, created_at, max_devices, status, source, expires_at) \
  VALUES ('EQT-PROBE-$(date +%m%d-%H%M)','PLUS','2026-08-07T00:00:00Z',2,'active','admin','LIFETIME')"

# ② 调激活接口(测试 Worker)
curl -s -X POST https://eqt-drm-api-test.leeyelon.workers.dev/api/v1/activate \
  -H 'Content-Type: application/json' \
  -d '{"license_code":"EQT-PROBE-...","uuid_hash":"u1","cpu_hash":"c1","disk_hash":"d1"}'
# 预期:200 + 返回 signature。若 500 "Invalid hex string" → ED25519_PRIVATE_KEY 不是纯 hex

# ③ 验证签名必须能被测试公钥验证(ce07f0...),生产公钥(08443678...)必须拒绝
#    (命令见 scripts/ 或本地 node/openssl 派生验证)

# ④ 清理探针(先删子表再删主表)
CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db-test --remote \
  --command "DELETE FROM activations WHERE license_code LIKE 'EQT-PROBE-%'; \
             DELETE FROM licenses WHERE license_code LIKE 'EQT-PROBE-%'; \
             DELETE FROM device_registry WHERE uuid_hash LIKE 'probe-%'"
```

### 4.2 GUI 激活 E2E 测试

```bash
cd desktop/gui
wails dev -tags eqtdev        # 连接测试 Worker(内置测试公钥 ce07f0...)
```
1. 打开 About 面板 → 输入激活码(4.1 插入的探针码,或沙箱购买的真实测试码)。
2. 激活成功 → `license.lic` 落盘,About 显示 PLUS/Pro 付费态。
3. 生产 release 构建(`wails build` 无 tag)激活**同一测试码必须失败** —— 验证隔离正确。

### 4.3 网页切换测试

- `js/api-base.js` 按域名自动切:`test.eqt.net.im` / `*.eqt-test.pages.dev` → 测试 Worker,其余 → 生产。
- 本地验证:`cd cloudflare/eqt-website && npx wrangler pages dev ./`,Network 面板确认请求发到 `localhost:8787`(本地直连,不发云端)。

### 4.4 自动部署测试

- push 到 `dev` 分支 → Actions **Deploy Test** 自动部署两个测试 Worker(无审批)。
- 手动:`Actions → Deploy Test → Run workflow`(任意分支)。

---

## 5. 生产环境清理

> 原则:清理前先备份(`d1-backup.yml` 每日自动;重要操作手动 `wrangler d1 backup create`)。**删除不可逆**。

### 5.1 判断生产是否被测试数据污染

```bash
# 生产库扫测试码/探针码(source='test' 或含 PROBE)
CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote \
  --command "SELECT license_code, tier, source, status, created_at FROM licenses \
             WHERE source='test' OR license_code LIKE '%PROBE%' OR license_code LIKE '%E2E%'"
```

> 历史教训:2026-07-21 的 E2E MCP 测试码 `EQT-PLUS-20260721-E2EMCP-8888`(`source='test'`)曾残留生产库,已在本手册编写时清理。**任何浏览器 E2E/探针测试务必只写测试库。**

### 5.2 删除测试/误数据(D1)

```bash
# 先查子表引用,避免外键报错
SELECT COUNT(*) FROM activations WHERE license_code='<CODE>';
SELECT COUNT(*) FROM license_upgrades WHERE target_license_code='<CODE>';
SELECT COUNT(*) FROM unbind_records WHERE license_code='<CODE>';

# 按依赖顺序删除:activations → license_upgrades → unbind_records → licenses
CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote \
  --command "DELETE FROM activations WHERE license_code='<CODE>'; \
             DELETE FROM license_upgrades WHERE target_license_code='<CODE>'; \
             DELETE FROM unbind_records WHERE license_code='<CODE>'; \
             DELETE FROM licenses WHERE license_code='<CODE>'"

# 设备注册残留(probe 指纹)
CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote \
  --command "DELETE FROM device_registry WHERE uuid_hash LIKE 'probe-%'"
```

### 5.3 Secret 重置/泄露处理

```bash
# 覆盖(先部署后 put;wrangler 会自动建同名 worker 挂载)
echo -n '<新值>' | npx wrangler secret put <KEY>
# 查看已配置的 secret 名(值不可回读,泄露只能重置)
npx wrangler secret list
# 删除
npx wrangler secret delete <KEY>
```
泄露处置:立即 `secret put` 换新值 → 检查 Paddle/Telegram/SMTP 侧撤销旧凭据 → 通知相关方。

### 5.4 Worker 误部署回滚

```bash
cd cloudflare/<项目>
npx wrangler rollback            # 回退上一版本
npx wrangler versions deploy <version-id>   # 回退到指定版本
# 仪表盘:Workers & Pages → 项目 → Deployments → 选版本 → Deploy
```
回滚不影响 D1 数据;D1 数据损坏只能从备份恢复(见 README §7)。

### 5.5 R2 对象清理

```bash
npx wrangler r2 object delete <BUCKET> --remote <key>          # 删单个
npx wrangler r2 object list <BUCKET> --remote                  # 列表确认
```
> `eqt-downloads` 保留 `downloads/latest` 与 `downloads/vX.Y.Z` 历史版本,不要手动清理非测试对象。

### 5.6 缓存清理

- Worker 响应缓存:改 `wrangler.toml` cache 配置后重新部署即失效;等 TTL 自然过期。
- Pages/CDN 缓存:仪表盘 → 对应项目 → Caching → Purge Everything。
- 客户端本地缓存(update-metadata 等):等待 1 分钟边缘 TTL 过期。

### 5.7 测试资源回收(测试环境不再用时)

```bash
# 停用测试 Worker
cd cloudflare/eqt-drm-api && npx wrangler delete --env test
cd cloudflare/eqt-feedback-api && npx wrangler delete --env test
# 删除测试 D1/R2(测试数据无需保留)
npx wrangler d1 delete eqt-drm-db-test
npx wrangler r2 bucket delete eqt-crash-reports-test
# 可选:dev 分支 CI 里移除 deploy-test.yml 触发,避免重建
```
> 测试环境可随时按 [test-environment.md](./test-environment.md) 从零重建,回收无成本顾虑。

---

## 6. 防混淆检查清单(操作前必查)

| # | 自问 | 通过标准 |
|---|---|---|
| 1 | 我要操作哪个环境? | 能说出资源名/域名,且与意图一致 |
| 2 | wrangler 命令带 `--env test` 了吗? | 想测测试 → 必须带;**不带 = 生产** |
| 3 | D1/R2 资源名是 `-test` 后缀吗? | 是测试 → 必须 `eqt-drm-db-test` / `eqt-crash-reports-test` |
| 4 | Paddle 密钥是 sandbox 还是 live? | 测试 → `pdl_sdbx_`;生产 → `pdl_live_` |
| 5 | ED25519 secret 是纯 hex(64 字符)吗? | 是;贴 base64 PKCS8 会产生垃圾私钥(见 §7) |
| 6 | GUI 构建带 `-tags eqtdev` 了吗? | 想连测试 → 必须带;**不带 = 生产** |
| 7 | 生产库操作前备份了吗? | `wrangler d1 backup create eqt-drm-db --remote` |

---

## 7. 常见误操作与恢复

| 误操作 | 现象 | 恢复 |
|---|---|---|
| 测试 worker 抢占了生产路由 | 生产域名 404/异常 | 检查 `[env.test]` 是否 `routes = []` + `workers_dev = true`,修正后重部署 + `wrangler rollback` 生产 |
| 测试 worker 配了 live 密钥 | 测试激活码 `source='purchase'` | `secret put PADDLE_API_KEY --env test` 换回 sandbox |
| `ED25519_PRIVATE_KEY` 误贴 base64 PKCS8 | 激活签名不被任何公钥验证(不报错) | 换成 32-byte seed 的 hex;GUI 公钥须与 seed 派生公钥一致 |
| 探针/E2E 写进了生产 D1 | 生产库出现 `source='test'` 或 `EQT-*E2E*` 码 | 按 §5.2 删除 |
| GUI 测试构建忘了 `-tags eqtdev` | 激活码发往生产 lic.eqt.net.im | 加 tag 重新构建;误激活只影响测试,不影响生产数据 |

---

## 8. 测试环境速查

| 项目 | 地址 / 命令 |
|---|---|
| DRM API 测试基地址 | `https://eqt-drm-api-test.leeyelon.workers.dev` |
| Feedback 测试基地址 | `https://eqt-feedback-api-test.leeyelon.workers.dev` |
| GUI 切测试 | `wails dev -tags eqtdev` |
| 测试密钥对 | seed `2cf5baa8...`(hex)/ 公钥 `ce07f0...`(见 `.env.test` 尾部注释) |
| 完整搭建 | [test-environment.md](./test-environment.md) |
