---
title: "CLI 命令行完全速查"
description: "EQT 终端命令行所有子命令、参数标志（Flags）与极客进阶用法权威参考。"
---

# CLI 命令行完全速查

EQT 的核心引擎采用原生 Go 语言编写，提供精炼高效的命令行界面（CLI）。无论是在服务器无头环境、本地终端还是自动化脚本中，都能快速调用。

---

## 核心子命令 (Subcommands)

### 1. 发送文件或目录 (Send / Share)
未输入子命令且参数为文件/目录路径时，默认为发送模式：
```bash
# 发送单个文件
eqt MyDocument.pdf

# 发送多个文件并指定自定义端口
eqt --port 8080 Video.mp4 Presentation.pptx

# 发送整个目录（自动开启实时流式打包）
eqt /home/user/Projects/
```

### 2. 接收文件 (Receive)
```bash
# 启动接收服务监听，等待移动端扫码上传
eqt receive

# 指定接收文件的保存路径（短选项 -o）
eqt receive -o ~/Desktop/Downloads
```

### 3. 局域网即时协同聊天 (Chat)
```bash
# 启动局域网 Chat 协同服务
eqt chat

# 启动 Chat 并在电脑默认浏览器中自动打开管理控制台
eqt chat --browser
```

### 4. 交互式网络配置向导 (Config)
```bash
# 启动终端交互向导，自选网卡、默认端口及路径前缀
eqt config
```

### 5. 自动补全脚本生成 (Completion)
```bash
# 为当前 Shell 生成自动补全脚本
eqt completion bash > /etc/bash_completion.d/eqt
eqt completion zsh > "${fpath[1]}/_eqt"
```

---

## 全局命令行参数表 (Flags)

以下参数经过与源码严格比对验证，全面支持在所有相关子命令中使用：

| 参数选项 | 简短选项 | 默认值 | 作用与功能说明 |
| :--- | :---: | :---: | :--- |
| `--interface` | `-i` | 自动选择 | 强制指定本地绑定的网络接口（如 `eth0`、`wlan0`、`Wi-Fi`） |
| `--port` | `-p` | `0` (随机) | 指定服务监听的本地端口（`0` 表示自动分配未占用的空闲端口） |
| `--bind` | | `0.0.0.0` | 绑定的本地监听 IP 地址（无短选项，注意勿混淆为 `-b`） |
| `--browser` | `-b` | `false` | 二维码生成后，自动在桌面默认浏览器中打开展示 |
| `--secure` | `-s` | `true` | 是否启用受信任的 HTTPS 绿锁直连通道 |
| `--output` | `-o` | 用户下载目录 | （仅接收模式）指定文件物理落盘保存的目录路径 |
| `--keep-alive` | `-k` | `false` | 传输完成后保持本地服务器继续运行，不自动退出进程 |
| `--quiet` | `-q` | `false` | 静默模式，只在终端输出错误信息，隐藏传输进度条 |
| `--zip` | `-z` | `false` | 强制在传输前将内容压缩为 zip 归档 |
| `--fqdn` | `-d` | 自动计算 | 覆盖二维码中最终生成的主机名或完全限定域名 |
| `--path` | | 随机字符串 | 自定义 HTTP 服务的 URL 路径前缀（如 `/my-share`） |
| `--config` | `-c` | 默认配置目录 | 指定外部自定义 YAML 配置文件路径 |
| `--list-all-interfaces` | `-l` | `false` | 交互选择网卡时，强制列出所有可用接口（含虚拟网卡） |
| `--reversed` | `-r` | `false` | 反转终端二维码颜色（白底黑字，适配特定终端配色） |
| `--tls-cert` | | 空 | 手动指定自定义 TLS 证书路径（自托管离线模式使用） |
| `--tls-key` | | 空 | 手动指定自定义 TLS 私钥路径（自托管离线模式使用） |
