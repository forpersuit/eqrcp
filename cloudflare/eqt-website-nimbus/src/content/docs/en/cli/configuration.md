---
title: "Configuration & Environment"
description: "Persist configuration settings and automate deployments using standard YAML configuration files and environment variables."
---

# Configuration & Environment Variables

To persist custom options or deploy EQT on headless servers and NAS appliances, EQT supports configuration via standard YAML files and environment variable overrides.

---

## Configuration File Locations

EQT conforms to standard operating system XDG application data specifications. The primary configuration file is named `config.yml`:

- **Windows**:
  ```text
  %APPDATA%\eqt\config.yml
  # Example: C:\Users\<Username>\AppData\Roaming\eqt\config.yml
  ```
- **macOS**:
  ```text
  ~/Library/Application Support/eqt/config.yml
  ```
- **Linux / POSIX**:
  ```text
  ~/.config/eqt/config.yml
  # (EQT automatically migrates legacy ~/.local/eqt/config.yml files seamlessly)
  ```
- **Custom Directory Override**: Override the entire configuration directory path by setting the `EQT_CONFIG_DIR=/path/to/dir` environment variable.

---

## Configuration Example (`config.yml`)

```yaml
# Network interface to bind (leave empty to auto-detect best Wi-Fi interface)
interface: ""

# Network listen address
bind: "0.0.0.0"

# Local listen port (0 assigns a random available port)
port: 0

# Default save path for received files
output: "~/Downloads"

# Keep server alive after transfer completes (CLI mode)
keepAlive: false

# Enable Let's Encrypt trusted LAN-TLS encryption
secure: true

# Custom URL route path prefix (leave empty for random string)
path: ""

# Custom fully qualified domain name (FQDN) for QR codes
fqdn: ""

# Invert QR code contrast for dark-background terminals
reversed: false

# Custom TLS certificate paths (for air-gapped self-hosted use)
tls-cert: ""
tls-key: ""
```

---

## Environment Variable Overrides (`EQT_*`)

Environment variables take precedence over settings in `config.yml`:

| Variable | Corresponding Setting | Example |
| :--- | :--- | :--- |
| `EQT_CONFIG_DIR` | Custom root config directory | `/etc/eqt` |
| `EQT_INTERFACE` | Network interface to bind | `wlan0` / `Wi-Fi` |
| `EQT_PORT` | Local listen port | `9090` |
| `EQT_BIND` | Local bind address | `127.0.0.1` / `0.0.0.0` |
| `EQT_OUTPUT` | Received file save directory | `/srv/storage/downloads` |
| `EQT_KEEPALIVE` | Keep alive after transfer | `true` / `false` |
| `EQT_SECURE` | Enforce HTTPS encryption | `true` / `false` |
| `EQT_FQDN` | Hostname override for QR code | `transfer.internal.lan` |

---

## Production Daemon Example

On Linux servers or NAS devices, launch EQT as a background daemon with a simple shell script:

```bash
#!/bin/bash
export EQT_PORT=9527
export EQT_OUTPUT="/data/nas-incoming"
export EQT_KEEPALIVE="true"

# Launch quiet receive listener in background
nohup eqt receive --quiet > /var/log/eqt.log 2>&1 &
```
