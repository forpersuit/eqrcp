# DRM 加固与 Windows 行为安全防线推进方案

> 状态：设计方案（未实施）
> 日期：2026-08-24
> 范围：3 项可开发推进的加固——① 免费配额"服务端确认已注册才授予"（含移除硬编码默认 key）；② WMI 失效时的注册表兜底 + 指纹豁免；③ Autostart 合规、稳妥、长久的回归路径
> 前置文档：`docs/report/device-registration-server-side.md`（设备码服务端化）、`docs/report/licensing-flow-audit.md`（交易流程审计）、`docs/windows-validation-checklist.md`
> 背景：2026-08-24 已移除开机自启动、硬件指纹改 WMI COM 直调（commit 3911810），本报告承接剩余的三点优化建议

---

## 一、免费配额"服务端确认已注册 device_id 才授予"

### 1.1 现状与核心事实

免费配额**执行点在客户端本地**，这是理解整个缺口的前提：

| 环节 | 位置 | 现状 |
|---|---|---|
| 配额判定 | `pkg/server/chat_limiter.go:39-42` `FreeChatDegraded`、`:653` `IncrementUsage` | 用本地 `usage.UsedSeconds >= FreeChatDailySeconds`(300s) 判定，**客户端本地为最终闸门** |
| 本地文件完整性 | `chat_limiter.go:404-415` `loadUsageLocked` | `MAC` = HMAC-SHA256(`machineKey`)，`machineKey = GetDeviceStableID()` |
| 设备身份 | `pkg/server/hardware.go:314-382` | 已注册 → 服务端下发 `device_id`（存 `device_id.dat`）；未注册 → `GetDeviceStableID()` 返回 `""` |
| 服务端权威同步 | `chat_limiter.go:567-636` `SyncUsageToServer` → `POST /api/v1/device/sync-usage` | 已注册设备在线时以服务端为准（Ed25519 签名、fail-closed、取 max、`quota_exceeded` 强制本地 600s） |
| 服务端注册强制 | `cloudflare/eqt-drm-api/src/routes/drm.ts:1002-1012` | `sync-usage` **已要求** `device_id` 存在于 `device_registry`，未注册返回 404 |
| 未注册设备 | `chat_limiter.go:572-575` | `devID == ""` 时 `SyncUsageToServer` **直接 return**——不上报、不对齐、不校验 |

**结论：在线且已注册的路径已被服务端权威化（注册强制 + 签名）封死；真正的缺口集中在"未注册 / 离线"时对本地文件的信任，而该信任建立在硬编码默认 key 上。**

### 1.2 威胁模型与攻击路径

攻击者已知 `EQT_DEFAULT_USAGE_KEY` 是**编译进二进制的硬编码常量**（`chat_limiter.go:346-349`、`363-366`），攻击路径：

1. **手写默认 key 签名文件**：构造合法的 `chat_usage.json`（Date=今天、UsedSeconds=0 或其他值），用默认 key 计算 HMAC 写入 → 删除 `device_id.dat` 使 `GetDeviceStableID()==""` → 本地配额判定读到该文件，分支 `:413`（`machineKey==""` 且默认 key 签名）判定合法 → **免费配额可无限重置**。
2. **主动回退**：已注册设备删掉 `device_id.dat` + 证书，退回未注册态，配合路径 1。
3. **跨设备复制**：整目录复制（含 key）等同克隆环境，属服务端 `device_registry` 检测范畴，不在本次本地修复范围。

当前分支 `:410`/`:413` 接受默认 key 签名但**从不改写**，兼容窗口是永久的。

### 1.3 设计（三层）

**L0 在线路径（现状，保留）**：`sync-usage` 注册强制 + Ed25519 签名 SSOT。已满足"在线时服务端确认已注册才授予"。

**L1 移除硬编码默认 key（核心修复）——未注册设备改用持久化随机 ephemeral key：**

- 新增 `config.DefaultConfigDir()/usage_key.dat`（0600，与 `device_id.dat` 并列）：
  - 启动时读取，不存在则 `crypto/rand` 生成 32 字节写入（仅未注册设备需要）。
  - 已注册设备不生成，直接用权威 `device_id` 作 `machineKey`。
- `loadUsageLocked` MAC 验证改造（`chat_limiter.go:404-415`）：
  - `machineKey` 解析改为：`GetDeviceStableID()` 非空 → 用它；否则 → ephemeral key。
  - 删除分支 `:413`（`machineKey==""` 且默认 key 签名——在 `machineKey==""` 时与 `:408` 恒等价，`computeUsageMAC("")` 内部归一化为默认 key，纯冗余）。
  - 分支 `:410`（已注册但文件仍为默认 key 签名）保留为**一次性迁移**：命中后标记 `migratedMAC=true`，并入 `:506` 保存条件强制落盘（用真实 `device_id` 重签 V2 MAC）。迁移完成后删除 `:410`，兼容窗口彻底关闭。
- 效果：
  - 未注册设备无法手写伪造（ephemeral key 随机，不硬编码，重启后凭 `usage_key.dat` 保持当天配额，重装即重置——本可接受）。
  - 跨设备复制：目标机器 ephemeral key 不同 → 签名不匹配 → `tampered` 锁。
  - `device_id.dat` 被删回退未注册态 → ephemeral key，仍无法伪造。

**L2 服务端强制（可选强化）——"未注册不给免费额度"fail-closed：**

- 客户端 `SyncUsageToServer`（`chat_limiter.go:595`）对 404 响应不再静默 `return`，而是置内存标记 `registrationPending=true`。
- `GetStatus`/`FreeChatDegraded` 读取该标记：在线且 `registrationPending` → 判定配额受限；离线（无网络）→ 沿用 L1 本地配额宽限，不惩罚冷启动。
- 需要一次状态缓存（内存 bool + 时间戳），避免每次 GetStatus 同步网络。

> L2 是产品决策：它把"未注册"从"本地自管理"变为"服务端门禁"，符合"服务端确认已注册才授予"，但要求首次联网必须完成匿名注册（`RegisterDeviceOnline` 已在启动时执行，`hardware.go:392-448`）。建议先做 L1（风险低、收益大），L2 单独立项评估 UX。

### 1.4 实施清单（L1）

| # | 改动 | 文件 |
|---|---|---|
| 1 | 新增 ephemeral key 读写（读/生成/删除） | `pkg/server/chat_limiter.go` 或新文件 |
| 2 | `machineKey` 解析：优先权威 id，回退 ephemeral key | `chat_limiter.go:404` |
| 3 | 删除分支 `:413`；`computeUsageMAC` 空 key 归一化移除或保留到迁移完成 | `chat_limiter.go:346-379,413` |
| 4 | 分支 `:410` 命中 → `migratedMAC` → 强制保存 | `chat_limiter.go:410,506` |
| 5 | 迁移完成后删除 `:410`，全库无默认 key 字符串（除软著归档） | 同上 |
| 6 | 单测：未注册伪造文件被拒、ephemeral 跨重启保留、迁移写回后旧分支失效 | `chat_limiter_test.go` |

### 1.5 边界与风险

- 重装系统 → `usage_key.dat` 丢失 → 当天配额重置（现状重装本就重置，无回归）。
- 软著申请材料 PDF 中可能含 `EQT_DEFAULT_USAGE_KEY` 字符串，**不改动归档**。
- L1 后"未注册设备离线仍可用本地配额"保留——这是有意的 UX 宽限，不是漏洞（无法伪造即可）。

---

## 二、WMI 失效时的注册表兜底 + 指纹豁免

### 2.1 现状

`pkg/server/hardware_windows.go` 用 `github.com/yusufpapurcu/wmi` 进程内 COM 查询，方向正确（0 子进程、0 杀软风险）。但 `queryWindowsBoardUUID`/`queryWindowsCPUSerial`/`queryWindowsDiskSerial` 在 **WMI/winmgmt 被禁用或损坏的精简/PE 环境**下返回 `""`，此时：

- 免费注册 `RegisterDeviceOnline`（`hardware.go:398`）只要 ≥1 项非空即可注册，影响小。
- 付费证书 `VerifyFingerprint`（`license.go:178-194`）是 **3-of-2**：board+CPU+disk 三字段非空才计数，WMI 全挂时最多 1 项有效 → **付费激活/校验失配**。

### 2.2 兜底实现（board 用 MachineGuid）

`hardware_windows.go` 的 `queryWindowsBoardUUID` 加注册表兜底：

```go
func queryWindowsBoardUUID() string {
    var dst []win32ComputerSystemProduct
    if err := wmi.Query("SELECT UUID FROM Win32_ComputerSystemProduct", &dst); err == nil && len(dst) > 0 {
        if u := strings.TrimSpace(dst[0].UUID); u != "" {
            return u
        }
    }
    // WMI 失效兜底：HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid
    // 仅此极端场景触发；MachineGuid 重装系统会变，正常机器走不到这里。
    k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Cryptography`, registry.QUERY_VALUE)
    if err != nil {
        return ""
    }
    defer k.Close()
    v, _, err := k.GetStringValue("MachineGuid")
    if err != nil {
        return ""
    }
    return strings.TrimSpace(v)
}
```

- 依赖 `golang.org/x/sys/windows/registry`（已在 `go.mod`，`hardware_windows.go` 是 windows-only build tag，天然不污染其他平台）。
- CPU/磁盘 serial 无纯注册表源（`ProcessorId`/磁盘 serial 无标准注册表键），**不兜底**——这正是下面豁免规则要覆盖的缺失场景。

### 2.3 指纹豁免规则调整（付费 3-of-2 → board 匹配 + 缺失豁免）

`license.go:177-194` `VerifyFingerprint` 改为：**board 匹配，且当前机器 CPU 或磁盘采集为空（WMI 缺失）时，放宽为 board 一项即通过**；两项均非空但失配仍严格判定，不放开克隆攻击面：

```go
func VerifyFingerprint(cert LicenseCertificate) bool {
    curUUID, curCPU, curDisk := GetDeviceFingerprintHashes()
    matches := 0
    if cert.UUIDHash != "" && curUUID != "" && cert.UUIDHash == curUUID {
        matches++
    }
    if cert.CPUHash != "" && curCPU != "" && cert.CPUHash == curCPU {
        matches++
    }
    if cert.DiskHash != "" && curDisk != "" && cert.DiskHash == curDisk {
        matches++
    }
    // WMI 失效兜底：board 匹配，但当前机器 CPU/磁盘采集缺失（WMI 挂掉）时豁免。
    // 字段非空却失配 → 仍按 3-of-2 严格判定，防止"伪造缺失"绕过。
    boardOK := matches >= 1 && cert.UUIDHash != "" && curUUID != "" && cert.UUIDHash == curUUID
    if boardOK && (curCPU == "" || curDisk == "") {
        return true
    }
    return matches >= 2
}
```

判定矩阵：

| board | CPU | disk | 结果 |
|---|---|---|---|
| 匹配 | 匹配 | 缺失/匹配 | ✅ 3-of-2 或豁免 |
| 匹配 | 缺失 | 匹配 | ✅ 豁免 |
| 匹配 | 失配 | 失配（非空） | ❌ 严格拒绝 |
| 失配 | 匹配 | 匹配 | ✅ 3-of-2（现状语义） |

> 注：豁免只看 `curCPU`/`curDisk` 是否为空（"我们采集不到"），不看 `cert` 侧——证书里某字段本来就没有，不应触发豁免，保持严格。

### 2.4 实施清单

| # | 改动 | 文件 |
|---|---|---|
| 1 | `queryWindowsBoardUUID` 加 MachineGuid 注册表兜底 | `pkg/server/hardware_windows.go` |
| 2 | `VerifyFingerprint` 加 board 豁免分支 | `pkg/server/license.go:177-194` |
| 3 | 单测：WMI 全空 → board 兜底命中；board 匹配 + CPU 空 → 豁免；board 失配 + 双字段失配 → 拒绝 | `license_test.go` / `hardware_test.go` |
| 4 | 注册请求可附 `wmi_degraded=true`（可选，服务端观测兜底机比例） | `hardware.go:403-409` + `drm.ts` |

### 2.5 风险

- **环境漂移**：某机器先走 MachineGuid 兜底（注册/激活时指纹=machineguid 哈希），后 winmgmt 恢复 → board 切回真实 UUID → 指纹变化 → 付费证书需重新激活。此类机器极少，且注册与激活走同一 `GetBoardUUID`，只要环境稳定就不漂移。建议在日志打印兜底来源（`[DRM] board uuid from MachineGuid fallback`）。
- **免费侧不受影响**：免费注册只要求 ≥1 项，豁免规则只改付费证书路径。

---

## 三、Autostart 合规回归路径（稳妥、长久）

### 3.1 约束（不可逾越）

- 禁止任何 PowerShell / VBScript / CMD / `wscript` 包装层（`-ExecutionPolicy Bypass` 字符串是 `Behavior:Win32/DefenseEvasion.A!ml` 决定性触发源，2026-08-24 已全库移除）。
- 禁止指向 CLI 子系统（`eqt.exe` 是 console subsystem，进 Run 键/快捷方式开机必闪黑框）。
- 只能指向 `-H=windowsgui` 二进制：`eqt-desktop.exe`（GUI，内嵌 agent + 托盘）。
- 卸载/移除必须干净（无残留注册表或快捷方式）。
- Defender `!ml` 行为检测只能在真实 Windows 验证（Event ID 1116）。

### 3.2 首选方案 B：NSIS 安装期向 Startup 文件夹放快捷方式

release.yml（`C1` 已规划 NSIS 接入）的 NSIS 脚本内，`Section` 用 `CreateShortcut` 写用户级 Startup 文件夹（`$SMPROGRAMS` 有管理员权限要求，Startup 用 `$SMSTARTUP` 或 SHGetFolderPath CSIDL_STARTUP），**无需管理员**：

```
; EQT 开机自启（可选，安装向导勾选）
Section "Run EQT at logon" SecAutostart
  SetShellVarContext current
  CreateShortCut "$SMSTARTUP\EQT.lnk" "$INSTDIR\eqt-desktop.exe" "--tray"
  WriteRegDWORD HKCU "Software\EQT" "AutostartShortcut" 1
SectionEnd

Section "Uninstall"
  Delete "$SMSTARTUP\EQT.lnk"
  DeleteRegValue HKCU "Software\EQT" "AutostartShortcut"
SectionEnd
```

- **为什么稳妥长久**：快捷方式是 OS 原生自启机制，无脚本包装、无隐藏窗口、杀软零触发；用户可见、可手动删除；卸载器统一清理；与"安装器负责系统集成"的产品边界一致。
- **开机不弹主窗口**：依赖 3.4 的 GUI `--tray` 静默参数。

### 3.3 备选方案 A：Run 键直写 windowsgui + `--tray`

与方案 B 等价、可二选一或并存，但**必须指向 `eqt-desktop.exe`**（当前架构单二进制合并后 `eqt.exe` 仍是 CLI 子系统，`windowsLauncherPath` 返回 exe 是给 shell 右键转发用，不是 GUI）：

```
HKCU\Software\Microsoft\Windows\CurrentVersion\Run
EQT = "\"...\eqt-desktop.exe\" --tray"
```

- 无黑框（windowsgui）、无包装脚本。
- 相比 B 的劣势：Run 键对用户不可见、排查难；卸载需 `DeleteValue`；部分杀软仍对 Run 键敏感。故仅作 B 的补充（若用户选择"不装快捷方式但想自启"）。

### 3.4 前置依赖：GUI 静默启动参数 `--tray`（两者都需要）

`desktop/gui/main.go` 增加 flag 解析（当前无任何启动 flag）：

```go
var trayOnly bool
flag.BoolVar(&trayOnly, "tray", false, "start minimized to tray (no main window)")
flag.Parse()
```

启动流程：`trayOnly` 为真时，`wails.Run` 后立即 `window.Hide()`（或创建窗口时 `HideWindowOnClose` 兼容），保留 `startTray()`（`main.go:389`）与内嵌 agent；托盘菜单已有 `Open Main Window`（`app.go:337` `eqt:tray-command` 通道）可唤起主窗口。需验证隐藏后托盘仍常驻、通知仍可达。

### 3.5 实施清单（归入 release 打包里程碑）

| # | 改动 | 文件 |
|---|---|---|
| 1 | GUI `--tray` 静默参数（flag 解析 + 启动即隐藏窗口） | `desktop/gui/main.go`、`desktop/gui/app.go` |
| 2 | NSIS 脚本：可选自启 Section + 卸载清理（方案 B） | `desktop/gui/build/*.nsi`（接入 release.yml C1 时） |
| 3 | 备选：`Run` 键直写（方案 A），需配一个 GUI 设置开关或卸载器处理 | `desktop/gui/` + `cmd/desktop_integration.go` |
| 4 | 真实 Windows 验证：安装 → 重启 → 托盘常驻不弹窗 → 卸载 → 无残留；Defender Event ID 1116 干净 | `docs/windows-validation-checklist.md` Deferred 批次 |

### 3.6 决策建议

- 若目标只是"开机静默后台"，**方案 B（NSIS 快捷方式）+ `--tray`** 是最稳、最长久的组合；方案 A 只在"希望命令行可编程自启"时补上。
- 本报告仅归档路径，不实施；实施时机与 `C1` NSIS 打包里程碑对齐。

---

## 四、总体优先级

| 优先级 | 项 | 理由 | 工作量估计 |
|---|---|---|---|
| P0 | §1.3 L1（移除默认 key + ephemeral key + 一次性迁移） | 封死免费配额伪造，零 UX 风险 | 中（~1 天 + 测试） |
| P1 | §2（MachineGuid 兜底 + board 豁免） | 极端环境付费可用性兜底，改动小 | 小（~半天） |
| P2 | §3（`--tray` + NSIS 自启） | 未来打包里程碑，非紧急 | 中（并入 release C1） |
| P3 | §1.3 L2（未注册 fail-closed） | 产品决策，需评估首次联网 UX | 中（需产品拍板） |

## 五、验证与回归

- 每项落地跑 `go test ./pkg/server/ ./cmd/`，涉及 GUI 跑 `cd desktop/gui && go test ./...`；pre-commit 触发完整 Windows 验收。
- 免费配额：未注册新环境 → 伪造文件被拒；已注册 → 迁移写回后旧默认 key 文件不再放行；重装（清 `usage_key.dat`）→ 配额重置。
- WMI 兜底：在 WMI 失效环境验证付费证书可用；回归 WMI 正常环境 3-of-2 语义不变。
- Autostart：见 §3.5 真实 Windows 清单。
