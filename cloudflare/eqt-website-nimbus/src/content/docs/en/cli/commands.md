---
title: "CLI Commands Reference"
description: "Comprehensive reference for all EQT command-line interface (CLI) subcommands, parameters, and flags."
---

# CLI Commands Reference

EQT's core engine is written in native Go, delivering a lightweight and high-throughput command-line interface (CLI). It operates seamlessly in headless servers, local developer terminals, and automated continuous delivery scripts.

---

## Core Subcommands

### 1. Send / Share Files or Directories
When no subcommand is supplied and positional arguments are file or directory paths, EQT operates in send mode by default:
```bash
# Send a single file
eqt MyDocument.pdf

# Send multiple files and specify a dedicated port
eqt --port 8080 Video.mp4 Presentation.pptx

# Send an entire directory (streamed on-the-fly)
eqt /home/user/Projects/
```

### 2. Receive Files
```bash
# Start receive listener and await mobile upload
eqt receive

# Specify target save directory (short flag -o)
eqt receive -o ~/Desktop/Downloads
```

### 3. Local Area Network Collaboration (Chat)
```bash
# Start headless LAN collaboration service
eqt chat

# Start chat service and automatically launch web console in default browser
eqt chat --browser
```

### 4. Interactive Configuration Wizard (Config)
```bash
# Launch interactive terminal setup for interface, port, and path bindings
eqt config
```

### 5. Shell Auto-Completion (Completion)
```bash
# Generate shell completion script for Bash or Zsh
eqt completion bash > /etc/bash_completion.d/eqt
eqt completion zsh > "${fpath[1]}/_eqt"
```

---

## Global CLI Flags

The following flags are verified against the core engine and supported across all relevant subcommands:

| Flag | Short | Default | Description |
| :--- | :---: | :---: | :--- |
| `--interface` | `-i` | Auto-detect | Force binding to a specific network interface (e.g., `eth0`, `wlan0`, `Wi-Fi`) |
| `--port` | `-p` | `0` (Random) | Port to bind the server to (`0` assigns a random available port) |
| `--bind` | | `0.0.0.0` | IP address for server binding (no short flag; do not confuse with `-b`) |
| `--browser` | `-b` | `false` | Automatically open the web console in the default desktop browser |
| `--secure` | `-s` | `true` | Enable trusted WebPKI HTTPS encryption |
| `--output` | `-o` | System Downloads | (Receive mode only) Directory where uploaded files are saved |
| `--keep-alive` | `-k` | `false` | Keep server running after transfer finishes rather than exiting |
| `--quiet` | `-q` | `false` | Suppress interactive progress output; print error logs only |
| `--zip` | `-z` | `false` | Force compression into a single zip archive |
| `--fqdn` | `-d` | Auto | Override the generated hostname or fully qualified domain name |
| `--path` | | Random string | Specify custom URL path prefix for HTTP routes (e.g., `/my-share`) |
| `--config` | `-c` | Default path | Specify path to external YAML configuration file |
| `--list-all-interfaces` | `-l` | `false` | List all network interfaces (including virtual adapters) in wizard |
| `--reversed` | `-r` | `false` | Invert terminal QR code contrast (light-on-dark terminals) |
| `--tls-cert` | | Empty | Path to custom TLS certificate (for air-gapped self-hosted use) |
| `--tls-key` | | Empty | Path to custom TLS private key (for air-gapped self-hosted use) |
