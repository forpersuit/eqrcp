# GUI 环境开关(dev 连测试 / release 连生产)

> 本文档说明桌面端 GUI 如何切换测试/生产环境。核心安全不变式:**release 二进制恒连生产**;只有显式的开发构建才连测试。
> 最后更新:2026-08-07
>
> 关联文档:[部署流水线总览](./README.md)、[测试环境](./test-environment.md)

---

## 1. 环境优先级(三层)

```
1. 运行时环境变量     EQT_LICENSE_SERVER / EQT_UPDATE_URL / EQT_CRASH_SERVER
2. 构建期 build tag   //go:build eqtdev(覆盖代码默认值)
3. 代码默认值         恒为生产 https://lic.eqt.net.im
```

| 层 | 优先级 | 说明 |
|---|---|---|
| 环境变量 | 最高 | `os.Getenv` 优先,任何构建都生效(含用户手动设置) |
| eqtdev build tag | 中 | 编译期注入测试 Worker URL,覆盖代码默认值 |
| 代码默认值 | 最低 | 恒生产,安全兜底 |

**安全不变式**:代码默认值恒为生产;测试环境只能通过显式的环境变量或 `-tags eqtdev` 进入。"漏配"方向永远安全——release 忘加 tag → 仍是生产。

## 2. 实现位置

| 默认值 | 生产(默认,`!eqtdev`) | 测试(`eqtdev`) |
|---|---|---|
| 激活/验证服务器 | `pkg/server/env_defaults.go` → `https://lic.eqt.net.im` | `pkg/server/env_defaults_dev.go` → 测试 Worker |
| 更新元数据 | `pkg/server/update.go` `getUpdateURL()` → 跟随 license server | 同左(一处注入,更新+激活同时切) |
| 崩溃上报 | `desktop/crash/env_defaults.go` → `lic.eqt.net.im/api/v1/crash-report` | `desktop/crash/env_defaults_dev.go` → 测试 Worker |
| Ed25519 验证公钥 | `pkg/server/env_defaults.go` → 生产公钥 `08443678...` | `pkg/server/env_defaults_dev.go` → 测试公钥 `ce07f0...` |

两个默认值文件带互斥 build tag(`//go:build !eqtdev` 与 `//go:build eqtdev`),构建时二选一。

验证公钥(`defaultPublicKeyHex` / `defaultUpdatePublicKeyHex`)同样按 tag 切换:release 恒用生产公钥验证,eqtdev 构建用测试专用公钥。因此测试激活码只能被测试构建验证,生产构建不会误认测试码(安全闭环,与「漏配方向安全」一致)。

**前端感知构建类型**:`AppInfo.isTest`(由 `server.IsTestBuild()` 按 build tag 注入)暴露给前端,用于测试/生产分支——例如「购买授权套餐」按钮:eqtdev 构建打开测试站 pricing(`eqt-test.pages.dev`),release 打开生产站 `www.eqt.net.im/pricing.html`。前端默认按生产处理,`isTest` 缺失时恒走生产(漏配方向安全)。

## 3. 对接方式

### 3.1 开发模式连测试(wails dev)

```bash
cd desktop/gui
wails dev -tags eqtdev        # GUI 激活/验证/更新/崩溃上报全部走测试 Worker
```

> 测试 Worker URL 已回填为 `https://eqt-drm-api-test.leeyelon.workers.dev`(子域 `leeyelon`,2026-08-07 部署)。

### 3.2 打包测试版桌面端

```bash
# 手动打一个连测试环境的 Windows 测试包(不走 release.yml)
cd desktop/gui
wails build -clean -tags eqtdev -platform windows/amd64
```

### 3.3 临时覆盖(任何构建)

```bash
export EQT_LICENSE_SERVER=https://eqt-drm-api-test.leeyelon.workers.dev
wails dev    # 或任意构建,环境变量优先于 build tag
```

## 4. 测试版本与生产版本全维度对比

除网络请求端点与密码学密钥对不同外，测试版本与生产版本的核心传输引擎、UI 界面与交互逻辑完全一致：

| 维度 | 生产版本（Release，`!eqtdev`） | 测试版本（`-tags eqtdev`） | 相同/差异说明 |
| :--- | :--- | :--- | :--- |
| **1. 业务与传输引擎** | 局域网 Chat、文件传输、拖拽分享、多网卡切换、剪贴板等 | 局域网 Chat、文件传输、拖拽分享、多网卡切换、剪贴板等 | **100% 相同**（核心代码完全复用） |
| **2. UI 界面与交互体验** | 主界面、设置面板、历史记录、多语言等 | 主界面、设置面板、历史记录、多语言等 | **100% 相同** |
| **3. DRM 验签公钥** | 生产 Ed25519 公钥 (`08443678...`) | 测试专用 Ed25519 公钥 (`ce07f02c...`) | **不同**：测试公钥只认测试 Worker 签发的激活码，生产码在测试版报错，反之亦然 |
| **4. DRM API 服务地址** | `https://lic.eqt.net.im/api/v1/*` | `https://lic-test.eqt.net.im/api/v1/*` | **不同**：激活、在线对账、配额同步打向独立测试 Worker |
| **5. 崩溃上报地址** | `https://lic.eqt.net.im/api/v1/crash-report` | `https://lic-test.eqt.net.im/api/v1/crash-report` | **不同**：写入测试 R2 存储桶 |
| **6. 自动更新检查端点** | `https://lic.eqt.net.im/update-metadata.json` | `https://lic-test.eqt.net.im/update-metadata.json` | **不同**：仅检查测试更新包且只认测试签名 |
| **7. 购买/定价页面跳转** | `https://www.eqt.net.im/pricing.html` | `https://test.eqt.net.im/pricing.html` | **不同**：测试版打开沙箱测试支付页面（Paddle Sandbox） |
| **8. 授权管理门户跳转** | `https://www.eqt.net.im/portal.html` | `https://test.eqt.net.im/portal.html` | **不同**：测试版打开测试客户门户 |
| **9. 数据库物理隔离** | Cloudflare D1 `eqt-drm-db` | Cloudflare D1 `eqt-drm-db-test` | **不同**：测试数据完全隔离，绝不污染生产用户数据 |

## 5. 安全不变式(release 绝不连测试)

- `release.yml` 的 `wails build` **不得**添加 `-tags eqtdev` 或任何 `-X` 测试 URL 注入(文件内已加注释防误改)。
- 发布二进制连测试的唯一途径是用户在自己机器上**手动**设置环境变量——这是用户主动行为,与"默认连测试"无关。
- 部署流水线(`deploy.yml`)只部署 Cloudflare Worker,不构建桌面端,不涉及此开关。

## 6. 回归检查点(改动默认值后必跑)

```bash
go test ./...                    # 全量测试(默认值生产断言在 pkg/server/update_test.go)
go build -tags eqtdev ./...      # 验证 eqtdev 构建可编译(与生产文件互斥,不冲突)
```
