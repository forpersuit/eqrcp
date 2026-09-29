---
title: "Konfigurationsdateien und Umgebungsvariablen"
description: "Dauerhafte Einstellungen und Automatisierung über Standard-YAML-Dateien und EQT_*-Umgebungsvariablen."
---

# Konfigurationsdateien und Umgebungsvariablen

Um Einstellungen dauerhaft zu speichern oder EQT auf Servern und NAS-Geräten unbeaufsichtigt auszuführen, unterstützt EQT Standard-YAML-Dateien und Umgebungsvariablen.

---

## Speicherorte der Konfigurationsdatei

EQT folgt der XDG-Spezifikation für Konfigurationsdateien. Die Datei heißt `config.yml`:

- **Windows**:
  ```text
  %APPDATA%\eqt\config.yml
  # Beispiel: C:\Users\<Benutzer>\AppData\Roaming\eqt\config.yml
  ```
- **macOS**:
  ```text
  ~/Library/Application Support/eqt/config.yml
  ```
- **Linux / POSIX**:
  ```text
  ~/.config/eqt/config.yml
  ```
- **Verzeichnis überschreiben**: Mit `EQT_CONFIG_DIR=/pfad/zum/ordner` lässt sich der Speicherort flexibel anpassen.

---

## Konfigurationsbeispiel (`config.yml`)

```yaml
# Zu bindende Schnittstelle (leer lassen für beste Wi-Fi-Erkennung)
interface: ""

# Server-Bind-Adresse
bind: "0.0.0.0"

# Lokaler Port (0 wählt zufälligen freien Port)
port: 0

# Speicherordner für empfangene Dateien
output: "~/Downloads"

# Nach Übertragungsende weiterlaufen
keepAlive: false

# Sichere Let's Encrypt LAN-TLS-Verschlüsselung aktivieren
secure: true

# Eigener URL-Pfadpräfix (leer lassen für Zufallszeichen)
path: ""

# Eigener Hostname / FQDN für QR-Codes
fqdn: ""

# QR-Code-Invertierung im Terminal
reversed: false

# Eigene TLS-Zertifikate für Air-Gap-Systeme
tls-cert: ""
tls-key: ""
```

---

## Überschreibung per Umgebungsvariablen (`EQT_*`)

Umgebungsvariablen haben Vorrang vor der `config.yml`:

| Variable | Entsprechende Option | Beispiel |
| :--- | :--- | :--- |
| `EQT_CONFIG_DIR` | Konfigurationsordner | `/etc/eqt` |
| `EQT_INTERFACE` | Schnittstelle | `wlan0` / `Wi-Fi` |
| `EQT_PORT` | Lokaler Port | `9090` |
| `EQT_BIND` | Bind-Adresse | `127.0.0.1` / `0.0.0.0` |
| `EQT_OUTPUT` | Download-Zielpfad | `/srv/storage/downloads` |
| `EQT_KEEPALIVE` | Nach Transfer aktiv | `true` / `false` |
| `EQT_SECURE` | HTTPS erzwingen | `true` / `false` |
| `EQT_FQDN` | Hostname für QR-Code | `transfer.internal.lan` |

---

## Beispiel: Linux Daemon / NAS-Startskript

```bash
#!/bin/bash
export EQT_PORT=9527
export EQT_OUTPUT="/data/nas-incoming"
export EQT_KEEPALIVE="true"

# Im Hintergrund starten
nohup eqt receive --quiet > /var/log/eqt.log 2>&1 &
```
