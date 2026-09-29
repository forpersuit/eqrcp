---
title: "設定ファイルと環境変数"
description: "YAML 設定ファイルおよび EQT_* 環境変数を使用した設定の永続化と自動化手順。"
---

# 設定ファイルと環境変数

カスタム設定を永続化したり、NAS や Linux サーバーで常駐デーモンとして実行する場合、EQT は標準の YAML ファイルおよび環境変数による設定に対応しています。

---

## 設定ファイルの保存場所

EQT は OS 標準の XDG 仕様に準拠しています。メイン設定ファイル名は `config.yml` です：

- **Windows**:
  ```text
  %APPDATA%\eqt\config.yml
  # 例: C:\Users\<ユーザー名>\AppData\Roaming\eqt\config.yml
  ```
- **macOS**:
  ```text
  ~/Library/Application Support/eqt/config.yml
  ```
- **Linux / POSIX**:
  ```text
  ~/.config/eqt/config.yml
  ```
- **設定フォルダの上書き**: `EQT_CONFIG_DIR=/path/to/dir` 環境変数を設定することで、全体の保存先を変更できます。

---

## 設定ファイルの構成例 (`config.yml`)

```yaml
# バインドするネットワークインターフェース (空欄で最適な Wi-Fi を自動選択)
interface: ""

# リッスン IP アドレス
bind: "0.0.0.0"

# リッスンポート (0 で空きポートを自動選択)
port: 0

# ファイル受信時のデフォルト保存先
output: "~/Downloads"

# 転送完了後もプロセスを終了しない
keepAlive: false

# Let's Encrypt LAN-TLS 暗号化を有効化
secure: true

# カスタム URL パスプレフィックス (空欄でランダム文字列)
path: ""

# カスタムドメイン名 (FQDN)
fqdn: ""

# ターミナルの QR コードコントラスト反転
reversed: false

# 完全オフライン環境用のカスタム証明書
tls-cert: ""
tls-key: ""
```

---

## 環境変数による上書き (`EQT_*`)

環境変数は `config.yml` の設定よりも常に優先されます：

| 環境変数 | 対応する設定項目 | 例 |
| :--- | :--- | :--- |
| `EQT_CONFIG_DIR` | 設定ルートディレクトリ | `/etc/eqt` |
| `EQT_INTERFACE` | バインドインターフェース | `wlan0` / `Wi-Fi` |
| `EQT_PORT` | リッスンポート | `9090` |
| `EQT_BIND` | リッスンアドレス | `127.0.0.1` / `0.0.0.0` |
| `EQT_OUTPUT` | 受信ファイル保存先 | `/data/downloads` |
| `EQT_KEEPALIVE` | 転送後の常駐 | `true` / `false` |
| `EQT_SECURE` | HTTPS 強制 | `true` / `false` |
| `EQT_FQDN` | QR コード用ホスト名 | `transfer.internal.lan` |

---

## 本番バックグラウンド常駐の例

Linux サーバーや NAS 上でバックグラウンド実行するシェルスクリプト例：

```bash
#!/bin/bash
export EQT_PORT=9527
export EQT_OUTPUT="/data/nas-incoming"
export EQT_KEEPALIVE="true"

# バックグラウンドで静かに受信待機
nohup eqt receive --quiet > /var/log/eqt.log 2>&1 &
```
