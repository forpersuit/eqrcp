# EQT 自动更新机制与设置设计方案 (Auto-Update Mechanism Design)

本文档阐述了 EQT (包括 Wails 桌面客户端与 CLI 应用) 的自动更新机制。更新机制的整体架构遵循**安全第一、原子替换、非阻塞体验与平台差异化适配**的第一性原理进行设计。

---

## 1. 自动更新设置项设计 (Settings Schema)

为了让用户能完全控制客户端的更新行为，在配置管理系统 (基于 [settings.go](file:///home/yelon/develop/me/eqrcp/config/settings.go)) 与前端设置页面中加入如下配置项。

### 1.1 字段定义

在 `DesktopSettings` 结构体中扩展以下字段：

```go
type DesktopSettings struct {
	// ... 现有字段 ...

	// AutoUpdateMode 控制自动更新的行为模式
	// 可选值: "off" | "notify" | "download" | "silent"
	// 默认值: "download"
	AutoUpdateMode string `json:"autoUpdateMode"`

	// UpdateChannel 更新通道
	// 可选值: "stable" (稳定版) | "beta" (测试版) | "nightly" (开发预览版)
	// 默认值: "stable"
	UpdateChannel string `json:"updateChannel"`

	// LastUpdateCheckTime 上一次执行更新检测的时间戳 (Unix 时间戳，秒)
	// 用于限制频繁的 API 轮询请求，默认 0
	LastUpdateCheckTime int64 `json:"lastUpdateCheckTime"`

	// UpdateCheckIntervalHours 检查更新的时间间隔 (小时)
	// 默认值: 24 (每日检测一次)
	UpdateCheckIntervalHours int `json:"updateCheckIntervalHours"`
}
```

### 1.2 行为模式详解 (AutoUpdateMode)

| 模式 | 描述 | 适用场景 |
| :--- | :--- | :--- |
| `off` | **关闭自动更新**。客户端不会在后台执行任何更新检测，仅在用户于设置界面点击“手动检查更新”时触发。 | 追求极度稳定、受控网络环境的用户。 |
| `notify` | **仅通知**。后台定期检测到新版本后，仅通过应用内通知提醒用户有新版本可用，不自动下载，由用户手动确认后触发下载。 | 流量计费网络、需要了解更新详情再做决定的用户。 |
| `download` <br>(**默认**) | **后台下载并通知重启**。后台检测到新版本时，自动在空闲时间下载更新包。下载完毕后，通过应用内通知提示用户“新版本已就绪，请重启应用以应用更新”。 | 多数普通用户，平衡了“自动无感下载”和“重启掌控权”。 |
| `silent` | **静默安装**。后台检测并自动下载新版本。当应用处于空闲状态（无传输任务）或在用户关闭应用时，静默替换文件，并在下次启动时无缝呈现新版本。 | 追求完全无感自动升级的用户。 |

---

## 2. 自动更新生命周期与核心机制 (Update Lifecycle)

整个更新流程是一个高可用的状态机，分为以下六个阶段：

```mermaid
graph TD
    A[启动或定时器触发] --> B{是否达到检测间隔/手动触发?}
    B -- 否 --> End([结束周期])
    B -- 是 --> C[向更新服务器查询最新版本元数据]
    C --> D{有新版本?}
    D -- 无 --> End
    D -- 有 --> E{检查 AutoUpdateMode}
    E -- off --> End
    E -- notify --> F[应用内通知用户有新版本]
    E -- download / silent --> G[后台异步下载更新包]
    G --> H[SHA-256 校验与 Ed25519 签名验证]
    H -- 校验失败 --> I[记录错误日志并废弃该文件]
    H -- 校验成功 --> J{更新模式为 silent?}
    J -- 是 --> K[等待应用空闲或退出时执行静默覆盖]
    J -- 否 --> L[应用内通知: 提示用户手动重启覆盖]
    K --> M[启动更新程序/进行原子替换]
    L --> M
    M --> N[新版本启动并验证运行状态]
    N -- 启动失败/崩溃 --> O[自动回滚至旧版本备份]
    N -- 启动成功 --> P[删除旧备份与临时文件，完成更新]
```

### 2.1 探测阶段 (Polling & Fetching)
为了减少前期的基础设施依赖，当前阶段的更新探测和下载链接获取直接基于 **GitHub Releases API** 实现。待未来部署了独立的更新分发服务器后，只需切换客户端的 Base URL 即可无缝迁移。

#### 2.1.1 版本检测机制
- **触发周期**：客户端启动时，以及启动后每隔 `UpdateCheckIntervalHours`（默认 24 小时）在后台启动一个 goroutine 发起非阻塞检测。
- **探测接口**：
  客户端向 GitHub 开放的 Release API 发送 HTTP GET 请求：
  ```
  GET https://api.github.com/repos/forpersuit/eqrcp/releases/latest
  ```
- **核心响应字段解析**：
  API 返回的 JSON 包含发布版本的所有元数据，客户端将解析以下字段：
  - `tag_name`: 最新发布的版本号标签（例如 `"v1.3.0"`）。
  - `body`: 版本的更新日志 Markdown 文本。
  - `assets`: 附件列表，每一个附件包含：
    - `name`: 资产文件名（例如 `"eqt-desktop-windows-amd64.exe"`）。
    - `browser_download_url`: 直接下载链接。

#### 2.1.2 新版本探测逻辑
1. **语义化版本比对**：
   客户端提取本地的 `AppVersion`（例如 `v1.2.0`）与 API 返回的 `tag_name`（例如 `v1.3.0`）进行语义化版本比对（Semantic Versioning）。若 `tag_name > AppVersion`，则判定存在新版本。
2. **下载资产匹配**：
   根据当前客户端所在的操作系统和架构（通过 Go 运行时的 `runtime.GOOS` 和 `runtime.GOARCH`），遍历 `"assets"` 列表。
   - **桌面端 (Wails)** 匹配规则：匹配 `name` 包含 `eqt-desktop-${GOOS}-${GOARCH}` 格式的文件（例如 `eqt-desktop-windows-amd64.exe`）。
   - **命令行端 (CLI)** 匹配规则：匹配 `name` 包含 `eqt-cli-${GOOS}-${GOARCH}` 格式的文件。
   提取对应资产的 `browser_download_url` 作为实际下载地址。

#### 2.1.3 API 频次控制 (Rate Limit Handling)
由于 GitHub 对匿名 API 请求有每小时 60 次的限制（Rate Limit）：
- **限制探测频次**：客户端本地严格通过配置中的 `LastUpdateCheckTime` 限制每日仅在后台探测一次，除非用户手动点击“检查更新”。
- **指数退避重试**：遇到网络异常或 `403 Rate Limit Exceeded` 时，下一次后台自动探测的时间间隔将呈指数级增加（1h -> 2h -> 4h -> 24h），严禁高频轮询。
- **未来迁移预留**：客户端设计 `UpdateServerType` 配置（`github` 或 `custom`）。未来当迁移到自建服务器时，将 `UpdateServerType` 改为 `custom`，并将请求地址重写为自建的元数据接口（如自建 `/api/v1/update/check` 接口），客户端无需重构核心下载和替换逻辑。

### 2.2 下载阶段 (Asynchronous Downloading)
- **并发与限速**：下载任务在独立的低优先级 goroutine 中执行，确保不抢占用户进行文件分享或聊天的局域网带宽。
- **断点续传**：下载器支持 HTTP `Range` 请求，如果遇到网络波动异常中断，在重试时会从已下载的字节处继续下载，避免重复消耗流量。
- **状态通知**：如果是 `download` 模式，前端设置界面应展示“正在后台下载新版本...”的进度条，但不可弹窗干扰用户的日常使用。

### 2.3 安全校验阶段 (Cryptographic Verification) — 关键防御
由于更新机制具有执行本地二进制代码的最高权限，极易成为黑客攻击的目标。必须通过以下三重手段进行安全防御：
1. **防降级攻击 (Anti-Downgrade)**：客户端必须校验元数据中的新版本号是否语义化大于（`>`）当前版本。拒绝执行任何等于或低于当前版本的“更新”请求，防止中间人通过重放旧版本元数据利用已知的旧版本漏洞。
2. **SHA-256 完整性校验**：下载完成后，计算本地临时文件的 SHA-256 哈希值，与元数据中的 `sha256` 字段比对，确保文件在传输中未损坏。
3. **Ed25519 非对称秘钥验签 (Cryptographic Signatures)**：
   - 客户端内置公钥（可复用授权校验中使用的 Ed25519 公钥，或单独使用一个更新公钥）。
   - 服务端发布的每个更新包都必须使用配套的离线私钥对其哈希进行数字签名，并在元数据中提供 `signature`。
   - 客户端使用内置公钥对 `signature` 进行验签。**只有验签通过的包才会被允许执行**，即使 HTTPS 证书被劫持或 CDN 节点文件被篡改，黑客也无法伪造合法签名的可执行文件。

### 2.4 文件覆盖阶段 (Platform-Specific Replacement)
替换正在运行的可执行文件存在平台差异，需要针对性设计：

#### 2.4.1 Windows 平台 (正在运行的可执行文件被锁定)
在 Windows 下，操作系统会锁定处于运行状态的 `.exe` 文件，直接写入会触发 `Access Denied` 错误。

- **方案 A（重命名暂存法）**：
  Windows 允许重命名正在运行的可执行文件。
  1. 将正在运行的 `eqt-desktop.exe` 重命名为 `eqt-desktop.exe.old`。
  2. 将新下载解压好的 `eqt-desktop.exe` 写入原路径。
  3. 当用户确认重启或下次启动时，拉起新版本的 `eqt-desktop.exe`。
  4. 新版本 `eqt-desktop.exe` 启动后，在后台异步删除 `eqt-desktop.exe.old` 文件。
  
- **方案 B（启动器代理更新法 - 推荐）**：
  由于 EQT 拥有辅助进程 `eqt-launcher.exe`（用于管理后台服务和快捷启动）：
  1. `eqt-desktop.exe` 下载并验证更新包完毕后，写入临时目录。
  2. 向 `eqt-launcher.exe` 发送更新指令，并退出 `eqt-desktop.exe`。
  3. `eqt-launcher.exe` 检测到主进程已退出，将临时目录的新文件覆盖至主程序路径。
  4. 覆盖完成后，`eqt-launcher.exe` 重新拉起 `eqt-desktop.exe`。

#### 2.4.2 Linux 与 macOS 平台 (POSIX 标准)
在 POSIX 系统上，文件的替换要简单很多，但仍需注意权限和原子性：
1. 新二进制文件下载到 `eqt.tmp`。
2. 调用 `os.Chmod(filepath, 0755)` 赋予可执行权限。
3. 使用 `os.Rename("eqt.tmp", "eqt")` 进行原子替换。由于 Unix 系统的 inode 特性，这会瞬间生效，即使原 `eqt` 正在运行也不会报错，已加载到内存的旧进程继续运行，直到重启。

#### 2.4.3 WSL 虚拟机环境适配
- **环境隔离**：在 WSL 中，必须区分当前运行的是 **WSL Linux 内的 CLI 二进制** 还是 **宿主 Windows 系统的桌面端**。
- **策略**：
  - WSL Linux CLI 仅更新其自身的 ELF 格式二进制。
  - 不允许 WSL 内的更新程序去直接修改或覆盖 `/mnt/c/...` 路径下的 Windows 端二进制文件，防止由于跨文件系统写入导致的权限混乱或死锁。所有的跨系统交互应基于 HTTP API 流转。

### 2.5 启动验证与灾难回滚阶段 (Rollback & Clean)
如果更新后的程序存在严重 Bug 导致无法启动，需要保证系统能够自我恢复：
- **心跳机制**：新版本程序启动时，在最初的 10 秒内，必须成功完成初始化并向系统注册“健康状态”。
- **自动回滚**：如果新程序在启动 10 秒内异常崩溃，或者无法正常启动：
  1. 守护进程 (如 `eqt-launcher`) 或旧程序备份逻辑被激活。
  2. 将备份的 `.old` 文件恢复为正式文件名。
  3. 重新拉起旧版本。
  4. 上报更新失败日志，并在 settings 的更新状态中标记“更新失败，已回滚”。
- **清理工作**：如果新版本启动成功且稳定运行超过 10 秒，则彻底删除临时下载文件及 `.old` 备份文件。

### 2.6 基于 GitHub CI/CD 的发布与分发链条 (GitHub CI/CD Release Pipeline)
为了保证软件的交付完全自动化且具备透明性，整个更新分发体系强绑定于 GitHub Actions CI/CD。

#### 2.6.1 CI/CD 构建与加签阶段
每当开发者在仓库中打上新版本 Tag（例如 `v1.3.0`）并 push 到 GitHub 时，会自动触发以下 GitHub Actions 工作流：
1. **多平台编译构建**：在 Linux、Windows 虚拟机跑构建，编译出各平台资产压缩包（如 `eqt-desktop-windows-amd64.zip`, `eqt-cli-linux-amd64.tar.gz` 等）。
2. **生成 SHA-256 校验和**：
   ```sh
   sha256sum eqt-desktop-windows-amd64.zip > checksums.txt
   ```
3. **安全加签**：读取保存在 GitHub Repository Secrets 中的 Ed25519 私钥（`UPDATE_SIGNING_PRIVATE_KEY`），对生成的每个二进制资产包执行加密签名，生成配套的签名值文件（如 `eqt-desktop-windows-amd64.zip.sig`）。
4. **生成版本元数据元组 (`update-metadata.json`)**：
   在 CI/CD 中自动生成更新描述元数据：
   ```json
   {
     "version": "v1.3.0",
     "published_at": "2026-06-20T12:00:00Z",
     "changelog": "1. 优化了大文件局域网传输速度;\n2. 修复了托盘图标显示异常。",
     "platforms": {
       "windows-amd64-gui": {
         "url": "https://github.com/forpersuit/eqrcp/releases/download/v1.3.0/eqt-desktop-windows-amd64.zip",
         "sha256": "8f3c7a...7a3f",
         "signature": "30450220...82e3c7"
       },
       "linux-amd64-cli": {
         "url": "https://github.com/forpersuit/eqrcp/releases/download/v1.3.0/eqt-cli-linux-amd64.tar.gz",
         "sha256": "4b2e1f...e18a",
         "signature": "30460221...1298c1"
      }
     }
   }
   ```
5. **发布 Release 资产**：
   工作流利用 `softprops/action-gh-release`，自动创建一个名为 `v1.3.0` 的 GitHub Release，并将上述编译包、`checksums.txt` 和 `update-metadata.json` 作为 Releases 附件上传。

#### 2.6.2 云端 Worker 中转与边缘缓存适配 (Cloudflare Workers Proxy & Caching)
为了规避匿名访问 GitHub Releases API 带来的 60次/小时 速率限制，同时保证国内用户在弱网环境下能稳定读取最新版本，我们已在**云端授权校验 Worker** ([cloudflare/src/index.ts](file:///home/yelon/develop/me/eqrcp/cloudflare/src/index.ts)) 中整合了版本检测的代理路由：
- **请求地址**：客户端发起 GET 请求：
  `GET https://license.eqt.dev/api/v1/update/check`
- **边缘缓存机制 (Cloudflare Cache API)**：
  为了避免客户端频繁轮询对云端 Worker 和 GitHub API 造成负载压力，Worker 内部集成了 Cloudflare 边缘缓存：
  - 首次请求时，Worker 在后台向 GitHub Releases 发起请求；
  - 成功获取数据后，将定制好的精简 JSON 响应，利用 `Cache-Control: public, s-maxage=3600`（缓存 1 小时）存入 Cloudflare 边缘 CDN 中；
  - 在接下来的 1 小时内，任何客户端请求此接口都将**直接命中缓存**返回，实现毫秒级响应，且不消耗任何 GitHub API 的额度。
- **安全身份鉴权与加速**：
  - Worker 在向 GitHub API 发送请求时，如果配置了 `GITHUB_TOKEN`（在云端以 Secret 形式安全保存），会自动带上 `Authorization: Bearer <TOKEN>` 头部，使我们在云端拥有每小时 5000 次的安全探测额度；
  - 在返回的 JSON 中，Worker 可以根据客户端的地理 IP 或环境，将 `"download_url"` 指向加速的 CDN 反代节点，进一步提高国内用户的下载成功率。

---

## 3. 设计注意事项与限制 (Important Considerations)

根据 EQT 项目的特殊性，设计与实现更新机制时需注意以下细节：

### 3.1 遵守非阻塞 UI 与 UX 准则 (UX Notifications)
- **禁止使用 Alert 弹窗**：根据项目的 [eqt-ux 规范](file:///home/yelon/develop/me/eqrcp/.agents/skills/eqt-ux/SKILL.md)，严禁使用阻塞式的浏览器级 `alert()` 弹窗或操作系统的阻塞式 Dialog 来提示用户有更新或更新错误。
- **应用内系统通知 (In-app System Messages)**：
  - 更新检测结果、下载进度、安装成功/失败通知等，均应作为“系统系统消息”优雅地追加到聊天消息列表中，或者在设置页面的“更新栏”静默展示。
  - 例如，在聊天页面底部追加一行特殊的系统气泡：
    > 💡 **系统提示**：EQT 新版本 v1.3.0 已经后台下载就绪。我们将于您空闲时或重启时应用此更新。[立即重启]
- **传输状态互斥**：在 `silent` 模式执行覆盖时，必须检查当前是否存在活跃的传输任务（上传或下载）。**只有在传输队列为空（空闲）时**才允许触发退出与覆盖，避免用户传输大文件时因自动更新导致断连。

### 3.2 局域网离线环境适配
- EQT 经常被用于无公网连接的纯局域网环境（如通过手机热点互传文件）。
- 更新机制 must 对“断网/无公网”状态具有鲁棒性：
  - 检测更新失败时，应静默失败（Silent Failure），不向用户抛出任何网络连接报错气泡。
  - 使用指数退避算法（Exponential Backoff）延长下一次检测时间（如从 1 小时、2 小时，逐渐退避到每 24 小时尝试一次），避免离线状态下持续请求导致不必要的 CPU 和日志开销。

### 3.3 激活与授权约束 (License Integrity)
- 更新包的替换过程必须绝对保证用户本地证书（如 `license.lic`，参见 [licensing-architecture.md](file:///home/yelon/develop/me/eqrcp/docs/licensing-architecture.md)）的安全。
- 严禁将更新包解压目录指向存放用户证书的敏感配置目录。更新程序在覆盖二进制时，不能触碰任何用户配置数据文件（如 `chat_usage.json` 或 `.config.yaml`）。

---

## 4. 落地步骤建议 (Implementation Steps)

1. **第一阶段：配置项落地**
   在 `config/settings.go` 中添加上述 4 个字段，并实现默认值解析与回写。
2. **第二阶段：后端更新检测与验签逻辑**
   在 Go 后端实现版本拉取、SHA256 计算与 Ed25519 签名验证逻辑，编写对应的单元测试。
3. **第三阶段：多平台覆盖逻辑与脚本支持**
   完善 Windows 平台下的重命名/启动器更新逻辑，验证 WSL/Linux 环境下的隔离性。
4. **第四阶段：前端 UI 对接**
   在 Wails 前端设置页面添加“自动更新模式”和“更新通道”的单选下拉框，并实现非阻塞的系统消息列表提醒。

---

## 5. GitHub CI/CD 更新链的测试与验证方法 (Testing & Validation)

为确保该自动化发布和更新链条稳定可靠，需按照以下三个层面推进测试方案：

### 5.1 单元测试（Go Backend Verification）
- **本地签名验证测试**：
  编写 `VerifyUpdateSignature` 单元测试，在测试中生成一对临时的 Ed25519 密钥。使用私钥对一个假的二进制包字节签名，再使用公钥校验，确认校验算法和哈希逻辑完全正确。
- **版本比对测试**：
  测试 `IsNewerVersion(current, target)`，涵盖常规语义化版本（如 `v1.2.0` < `v1.3.0`）、测试通道版本（如 `v1.3.0-beta`）以及异常非法版本号的处理。
- **退避轮询测试**：
  模拟持续网络请求失败，验证退避时间片是否按预期的 $2^n \times \text{Base}$ 指数级延长，避免在无公网的局域网环境里过度轮询耗电。

### 5.2 模拟测试（Metadata & Server Mocking）
- **模拟更新服务器**：
  在集成测试中启动一个本地测试 HTTP 服务器（Mock Update Server），返回构造好的 `update-metadata.json`。
- **验证下载与校验拦截**：
  - 模拟返回正确的哈希与正确签名：验证客户端能否顺畅进入“下载成功-就绪”状态。
  - 模拟篡改二进制内容（哈希不匹配）：验证客户端能否在下载后成功拦截并报错。
  - 模拟伪造签名（私钥与客户端公钥不配）：验证客户端是否能阻断并删除危险文件。

### 5.3 生产发布灰度验证（GitHub Actions Sandbox Release）
1. **GitHub Sandbox Tag 测试**：
   在测试分支上发布一个带有 `-test` 标识的 Tag（例如 `v1.3.0-test`）。
2. **流水线运行检查**：
   检查 GitHub Actions 任务运行状态，确认其能正确编译二进制、自动提取 GitHub Repository Secrets 进行加签，生成正确的 `update-metadata.json`，并将所有资产上传至 Releases。
3. **灰度检测校验**：
   启动本地开发模式下的 EQT 客户端，在配置文件中将检测源临时修改为该 Sandbox Release 地址，点击“检查更新”，观察客户端是否能顺畅下载该临时安装包并正常拉起，确认替换机制对 Windows 进程占用、Linux 权限提升处理得当。
