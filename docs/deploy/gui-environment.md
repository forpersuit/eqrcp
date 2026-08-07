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

两个默认值文件带互斥 build tag(`//go:build !eqtdev` 与 `//go:build eqtdev`),构建时二选一。

## 3. 对接方式

### 3.1 开发模式连测试(wails dev)

```bash
cd desktop/gui
wails dev -tags eqtdev        # GUI 激活/验证/更新/崩溃上报全部走测试 Worker
```

> 测试 Worker URL 已在 `env_defaults_dev.go` 中为占位符 `eqt-drm-api-test.<subdomain>.workers.dev`。按 [test-environment.md](./test-environment.md) §4.8 拿到实际子域后回填。

### 3.2 打包测试版桌面端

```bash
# 手动打一个连测试环境的 Windows 测试包(不走 release.yml)
cd desktop/gui
wails build -clean -tags eqtdev -platform windows/amd64
```

### 3.3 临时覆盖(任何构建)

```bash
export EQT_LICENSE_SERVER=https://eqt-drm-api-test.<subdomain>.workers.dev
wails dev    # 或任意构建,环境变量优先于 build tag
```

## 4. 安全不变式(release 绝不连测试)

- `release.yml` 的 `wails build` **不得**添加 `-tags eqtdev` 或任何 `-X` 测试 URL 注入(文件内已加注释防误改)。
- 发布二进制连测试的唯一途径是用户在自己机器上**手动**设置环境变量——这是用户主动行为,与"默认连测试"无关。
- 部署流水线(`deploy.yml`)只部署 Cloudflare Worker,不构建桌面端,不涉及此开关。

## 5. 回归检查点(改动默认值后必跑)

```bash
go test ./...                    # 全量测试(默认值生产断言在 pkg/server/update_test.go)
go build -tags eqtdev ./...      # 验证 eqtdev 构建可编译(与生产文件互斥,不冲突)
```
