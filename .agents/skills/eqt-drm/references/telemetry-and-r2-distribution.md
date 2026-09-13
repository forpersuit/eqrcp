# 匿名下载遥测、隐私保护与 R2 资产分发参考规范

本参考文档收录 R2 分发安装包加速直链、官网动态版本号解析、匿名下载埋点、隐私盐值安全准则、3D 地球仪 SQLite 裸列特性以及 90 天原子归档事务。

---

## 16. 匿名下载埋点 (Telemetry)、隐私保护与 3D 地球仪可视化规范 (Download Telemetry & Visualizations)

### 16.1 盐值防护与 Fail-Loud 安全准则 (P1 Zero-Tolerance)
- **绝对禁止 Fallback 盐**：`TELEMETRY_SALT` 必须且仅保存在 Cloudflare Worker Secret 中（`wrangler secret put TELEMETRY_SALT`）。服务端严禁使用任何形式的公开 fallback 盐值。
- **Fail-Loud 前置拒写**：若环境变量中缺失 `TELEMETRY_SALT`，`/api/v1/telemetry/download` 必须立即返回 500 并记录严重错误日志，拒绝写入任何明文或未受保护的 IP 哈希。
- **生产环境对齐校验 (Env-Guard)**：`assertEnvironmentAlignment` 在非测试环境下强制校验 `TELEMETRY_SALT` 的非空存在性。

### 16.2 地球仪最新版本语义序与 SQLite 裸列特性 (P2 Semantic Ordering)
- **禁止 `MAX(version)` 字符串聚合**：由于版本号（如 `"v1.36.9"` 与 `"v1.36.25"`）按字符串比对时存在字典序误导，严禁在 SQL 聚合中使用 `MAX(version)`。
- **SQLite 裸列 (Bare Column) 与实测行为**：在包含 `MAX(created_at) AS latest_download_at` 的分组查询中，选取 `version AS latest_version`（SQLite 裸列扩展机制在当前索引与单值 MAX 下实测提取取得最大时间行的版本字段）。若未来需要跨数据库引擎严格保证或进行更复杂维度聚合，建议采用关联子查询或窗口函数（如 `last_value(version) OVER (...)`）。

### 16.3 90 天数据归档与原子批处理事务 (P2 Atomic Retention)
- **Cloudflare D1 `batch()` 事务保证**：在定时任务 `scheduled` 中，对超期（> 90天）明细记录向 `daily_download_stats` 聚合插入（`INSERT ... ON CONFLICT DO UPDATE`）与后续删除（`DELETE FROM download_records`）必须包裹在单次 `env.DB.batch([insertStmt, deleteStmt])` 批处理调用中，确保两者处于单一 SQLite 事务内原子执行，杜绝因异常导致的永久重复累加。

### 16.4 官网动态埋点与真实版本解析 (P3 Dynamic Versioning)
- **禁止硬编码版本兜底**：前端 `trackDownload` 必须动态读取 `window.latestVersion` 或从下载直链/文件名中正则提取版本号，并严格经过 `/^v?\d+\.\d+\.\d+$/` 校验。若未就绪或格式非法则跳过，严禁硬编码静态历史版本兜底。

