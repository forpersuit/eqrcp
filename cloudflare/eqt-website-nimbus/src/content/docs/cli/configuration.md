---
title: "配置文件与环境变量"
description: "通过 YAML 配置文件与环境变量规范实现 EQT 偏好持久化与自动化运维部署。"
---

# 配置文件与环境变量

为了方便固定个人使用偏好或在无头服务器上进行脚本化部署，EQT 支持通过标准的 YAML 配置文件与环境变量进行参数定制。

---

## 统一配置目录标准

EQT 遵循现代操作系统的 XDG 与应用数据目录标准。配置文件名为 `config.yml`：

- **Windows**：
  ```text
  %APPDATA%\eqt\config.yml
  # 实际路径形如：C:\Users\<用户名>\AppData\Roaming\eqt\config.yml
  ```
- **macOS**：
  ```text
  ~/Library/Application Support/eqt/config.yml
  ```
- **Linux / POSIX**：
  ```text
  ~/.config/eqt/config.yml
  # (EQT 具备自适应迁移能力，若检测到旧版 ~/.local/eqt/config.yml 会自动无损迁移)
  ```
- **测试与自定义目录覆盖**：可通过设置环境变量 `EQT_CONFIG_DIR=/path/to/dir` 显式重定向配置目录。

---

## 配置文件完整示例 (`config.yml`)

```yaml
# 默认绑定的网络接口（留空则运行时自动探测最佳 Wi-Fi 物理网卡）
interface: ""

# 默认网络监听地址
bind: "0.0.0.0"

# 默认监听端口（0 表示由操作系统分配空闲端口）
port: 0

# 接收模式下文件的默认保存路径
output: "~/Downloads"

# 传输完成后是否保持服务存活（CLI 模式有效）
keepAlive: false

# 是否默认启用基于 Let's Encrypt 的受信任局域网 HTTPS 直连
secure: true

# 自定义服务 URL 路径前缀（留空表示使用随机字符）
path: ""

# 自定义二维码展示的主机名或域名（高级用法）
fqdn: ""

# 是否反转终端二维码颜色
reversed: false

# 自定义外部 TLS 证书路径（仅在完全脱机的自托管环境中使用）
tls-cert: ""
tls-key: ""
```

---

## 环境变量覆盖规则 (`EQT_*`)

可以通过导出环境变量直接覆盖上述配置，其加载优先级高于 `config.yml`：

| 环境变量名 | 对应配置项 | 典型示例 |
| :--- | :--- | :--- |
| `EQT_CONFIG_DIR` | 自定义配置与证书根目录 | `/etc/eqt` |
| `EQT_INTERFACE` | 强制绑定的网卡接口 | `wlan0` / `Wi-Fi` |
| `EQT_PORT` | 强制指定本地监听端口 | `9090` |
| `EQT_BIND` | 本地服务监听地址 | `127.0.0.1` / `0.0.0.0` |
| `EQT_OUTPUT` | 接收文件保存目录 | `/srv/storage/downloads` |
| `EQT_KEEPALIVE` | 传输完毕后保持运行 | `true` / `false` |
| `EQT_SECURE` | 强制启用 HTTPS 加密 | `true` / `false` |
| `EQT_FQDN` | 覆盖二维码中的域名 | `transfer.internal.lan` |

---

## 自动化后台运行实战

在 Linux 服务器或 NAS 上，可以通过简单的 Shell 脚本将其作为后台守护进程拉起：

```bash
#!/bin/bash
export EQT_PORT=9527
export EQT_OUTPUT="/data/nas-incoming"
export EQT_KEEPALIVE="true"

# 后台静默启动接收监听
nohup eqt receive --quiet > /var/log/eqt.log 2>&1 &
```
