# IMPORTANT — Admin 发布习惯（DoD）

> **必读**：Admin 相关改动的发布顺序、验收与禁止事项。  
> 违反「契约 → 后端 → 前端 → 测 → 双部署」顺序是生产事故的主要来源。

关联：[IMPORTANT_admin-config.md](./IMPORTANT_admin-config.md) · [api-contract.md](./api-contract.md) · [ops-guide.md](./ops-guide.md) · [progress.md](./progress.md)

---

## 1. 变更分类

| 类型 | 典型改动 | 必须部署 |
| :--- | :--- | :--- |
| **A. 仅契约/文档** | `docs/admin/*` | 推 git 即可 |
| **B. 仅 Worker Admin API** | `cloudflare/eqt-drm-api/src/**` | **Worker `wrangler deploy`** |
| **C. 仅 Admin SPA** | `cloudflare/eqt-admin/src/**` | **Pages `wrangler pages deploy`**（或等价 CI） |
| **D. 契约 + API + SPA** | 字段/路径变更 | **先契约文档 → Worker → 前端 → 双部署** |
| **E. Schema** | `schema.sql` / 新表索引 | 本地/remote `d1 execute` + 确认 runtime `CREATE IF NOT EXISTS` 覆盖 |

**只 `git push` 不会更新** `admin.eqt.net.im` 或 `lic.eqt.net.im`。

---

## 2. 标准发布流水线（类型 D 完整路径）

```text
1. 改 docs/admin/api-contract.md（破坏性字段必须先文档）
2. 改 cloudflare/eqt-drm-api（routes/utils）
3. 改 cloudflare/eqt-admin（types + 页面）
4. 本地：
     cd cloudflare/eqt-drm-api && npx tsc --noEmit && npm run test:admin
     cd cloudflare/eqt-admin && npm run build && npm run check
5. 更新 docs/admin/progress.md 验证记录（禁止写 secret）
6. git commit + scripts/git-push-smart.sh
7. 部署 Worker：
     cd cloudflare/eqt-drm-api && npx wrangler deploy
8. 部署前端（构建时钉死生产 API）：
     cd cloudflare/eqt-admin
     VITE_API_BASE=https://lic.eqt.net.im npm run build
     npx wrangler pages deploy dist --project-name eqt-admin
9. 生产冒烟（见 §4）
```

类型 B 可跳过 3/8；类型 C 可跳过 2/7，但 **C 仍须用正确的 `VITE_API_BASE` 构建**。

---

## 3. 命令速查

```bash
# Worker
cd cloudflare/eqt-drm-api
npx tsc --noEmit
npm run test:admin
npx wrangler deploy

# Pages
cd cloudflare/eqt-admin
VITE_API_BASE=https://lic.eqt.net.im npm run build
npx wrangler pages deploy dist --project-name eqt-admin
# 产出域：admin.eqt.net.im（自定义域）+ *.eqt-admin.pages.dev
```

密钥轮换、D1 应急 SQL：见 [ops-guide.md](./ops-guide.md)。  
GitHub 推送网络：仓库根目录 `scripts/git-push-smart.sh`（勿对 git 使用错误代理习惯）。

---

## 4. 生产冒烟清单（发布后必做）

**无 secret：**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://admin.eqt.net.im/
# 期望 200

curl -sS https://lic.eqt.net.im/api/v1/admin/health
# 期望 401 Unauthorized
```

**有 ADMIN_SECRET（仅本机 shell，勿写入日志仓库）：**

```bash
curl -sS -H "X-Admin-Secret: $ADMIN_SECRET" \
  https://lic.eqt.net.im/api/v1/admin/health | jq '.success,.status,.probes,.metrics'
# 期望 success=true；probes.db.ok=true；SMTP 在 env 齐全时应 ok
```

**浏览器：**

1. 打开 `https://admin.eqt.net.im/`，登录  
2. Overview KPI 有数  
3. 操作审计 / 错误审计可刷  
4. 健康页「真探针」可刷新  
5. 可选：发一枚短期测试码再吊销，确认审计出现 GENERATE/REVOKE（`waitUntil` 可能延迟 1–2s）

**前端是否为新版本：** 查看 HTML 引用的 `assets/index-*.js` 是否与本次 `dist` 一致；自定义域与 `*.pages.dev` 应同源 bundle。

---

## 5. 禁止事项

| 禁止 | 原因 |
| :--- | :--- |
| 只改前端、契约与 Worker 不一致 | 生产静默错误 / 字段 undefined |
| 把 `ADMIN_SECRET` 写进 `VITE_*` 或提交 `.env` | 密钥进静态资源与 git 历史 |
| 用 `?secret=` 鉴权 | 已废弃；易进日志 |
| 未跑 `test:admin` 就 deploy Worker | 回归成本高 |
| 假设 git push = 上线 | Cloudflare 需显式 deploy |
| 在进度/PR 中粘贴真实 secret | 泄露 |

---

## 6. 版本与文档同步

- Admin 功能增量：`cloudflare/eqt-admin` / `eqt-drm-api` 的 `package.json` **小版本 +1**（仓库惯例）  
- 契约变更：`api-contract.md` + `progress.md`「契约变更日志」一行  
- 发布完成后：`progress.md`「验证记录」一行（环境、命令、结果，无 secret）

---

## 7. Definition of Done（Admin 变更）

- [ ] 契约与实现一致  
- [ ] `tsc` / `test:admin` / `eqt-admin` build（及合理时 `check`）通过  
- [ ] 需要时 Worker + Pages **均已** deploy  
- [ ] 生产冒烟 §4 通过  
- [ ] progress / 契约日志已更新  
- [ ] 工作区无误提交的 secret / 调试垃圾文件  
