# 代码审查复盘与加固总账：近期提交（v1.36.141 ~ v1.36.147）缺陷治理

> **文档位置**：`docs/bugs/2026-09-16-recent-commits-deep-review-and-defect-analysis.md`  
> **基线版本**：`v1.36.141` → 终局加固 `v1.36.147`（提交 `ca3aff48`）  
> **治理准则**：第一性原理、零数据丢失底线、强契约加密验签、原生 Windows 桌面体验

---

## 一、 演进摘要与终局结论

在 `v1.36.141` ~ `v1.36.147` 迭代中，系统完成了配置自愈容灾、云端审计解耦、测试环境自动化分发三大核心能力的落地。审查期间共识别并治理了 **9 项具体缺陷（DEF-01 ~ DEF-09）** 及 **1 项界面交互协同优化**。

截至 `v1.36.147`：
- **核心包与专项测试 100% 通过**（`pkg/config`、`pkg/server`、`generate-update-metadata`、`desktop/crash` 等）；
- **前端模块具名导入审计与 `go vet` 零错误**；
- 自动更新协议、Windows 子系统黑框、跨包签名错配等全链路物理断裂隐患全部消除。

---

## 二、 缺陷清单与闭环加固矩阵 (Defect & Resolution Matrix)

| 编号 | 严重度 | 模块分类 | 缺陷核心根因 | 终局加固落地措施 (`v1.36.146 ~ v1.36.147`) | 验证状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DEF-01** | 🔴 严重阻断 | 自动更新协议 | 测试包命名（`EQT-test-*.zip`）无法命中客户端 `eqt-desktop-*.zip` 检索规则，更新 100% 报错 | 1. `update.go` 支持大小写忽略及 `targetTestBase` / `altTestBase` 兼容前缀；<br>2. `deploy-test.yml` 与 `github.ts` 同步输出标准包名。 | `TestCheckForUpdates_TestChannelNamingVariants` PASS |
| **DEF-02** | 🟠 高危体验 | CI 构建系统 | `deploy-test.yml` 遗漏 `-ldflags "-H=windowsgui"`，导致测试版启动附带黑色控制台 CMD 黑框 | `deploy-test.yml` 在 `wails build` 中补齐 `-ldflags "-H=windowsgui"`，确保生成纯 GUI 子系统程序。 | CI 流水线配置已校准 |
| **DEF-03** | 🟠 高危流程 | 发布脚本 | `publish-test.sh` 正则硬编码依赖 `\?t=...`，在干净 URL 下静默失配跳过静态更新 | 将正则调整为兼容可选时间戳 `(\?t=[^\"]+)?`，并同时覆盖标准名与历史兼容名。 | 脚本正则验证通过 |
| **DEF-04** | 🟠 违背原则 | 配置韧性 | `BackupCorruptConfigFile` 在原文件截断失败时主动执行 `os.Remove(backupPath)`，销毁受损配置快照 | 移除 `os.Remove`，严格恪守零数据丢失底线，原文件清空失败时保留备份并返回明确错误。 | `TestConfigChaos_BackupFailureProtectsOriginal` PASS |
| **DEF-05** | 🟡 状态污染 | 配置原子写 | `AtomicWriteConfigFile` 通过 `v.SetConfigFile(tmp)` 覆写路径，异常退出时污染外部 Viper 实例 | 改用 Viper 原生无副作用的 `v.WriteConfigAs(tmpFile)`，彻底消除实例内部配置路径指针污染。 | `TestConfigChaos_AtomicWrite_PreservesViperConfigFile` PASS |
| **DEF-06** | 🟡 资源竞争 | 配置生命周期 | `config.go` 使用 `defer file.Close()` 延迟关闭首次创建的空文件，在 Windows 下引发后续写锁冲突 | 统一复用即建即关的 `ensureConfigFile`，彻底杜绝跨函数的句柄长期占用。 | `pkg/config` 全套单测 PASS |
| **DEF-07** | 🔵 体验规范 | 国际化 | `FormatSelfHealNotice` 仅判断 `en`，其他小语种系统（德语/西语/日语等）盲目回退到中文 | 显式匹配 `zh`，其余语言统一按国际通用规范回退至英文提示。 | `TestConfigChaos_FormatSelfHealNotice_MultiLang` PASS |
| **DEF-08** | 🔴 严重阻断 | 动态元数据 | `generate-update-metadata` 主动过滤 `.sig` 文件，导致 R2 上 `update-metadata.json` 缺少签名条目必报签名缺失 | 移除 `.sig` 过滤逻辑，仅过滤 `update-metadata.json` 自身，确保签名资产随安装包完整入册。 | `TestGenerateMetadata_IncludesSigFilesAndExcludesMetadata` PASS |
| **DEF-09** | 🟠 高危安全 | 验签匹配 | `update.go` 主包与签名独立遍历取末尾项，多包交错时存在“跨包错配”导致 Ed25519 验签失败 | 确立强绑定机制：先按环境优先级确定唯一的 `mainAsset`，再严格查找 `strings.EqualFold(name, mainAsset.Name + ".sig")`。 | `TestCheckForUpdates_StrictSignatureBinding_NoCrossPairing` PASS |

---

## 三、 协同优化项归档

### GUI 顶部 TLS 锁子图标纯状态化展示
- **改动位置**：`desktop/gui/frontend/src/components/tls_status.js` 与 `desktop/gui/frontend/src/main.js`。
- **治理效果**：将 `<button class="topbar-tls-btn" ...>` 重构为只读展示型的 `<span class="topbar-tls-indicator" role="status" ...>`，取消点击跳转 Settings 面板的事件委托，保留鼠标悬停 Tooltip 提示，防止用户产生“点击可直接启停 TLS”的操作歧义。

---

## 四、 核心代码架构守则（后续变更防护）

1. **自动更新资产契约**：发布与元数据生成必须保证 `包名.sig` 与 `包名` 成对入库，客户端只认一对一严格命名的加密签名资产。
2. **Windows 编译必须包含子系统标识**：凡构建发布用户端 Windows GUI 二进制，必须携带 `-ldflags "-H=windowsgui"`。
3. **文件操作原则**：任何配置备份和落盘操作只增不减，绝不在错误处理分支中二次删除已落地的备份数据；原子写入严禁篡改全局或外部传参实例的状态机。
