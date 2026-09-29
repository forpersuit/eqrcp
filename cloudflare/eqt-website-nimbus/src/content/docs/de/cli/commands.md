---
title: "CLI-Befehlsreferenz"
description: "Vollständige Referenz aller EQT-Befehlszeilenoptionen, Unterbefehle und Parameter."
---

# CLI-Befehlsreferenz

Der Kern von EQT ist nativ in Go implementiert und bietet eine schlanke, extrem performante Befehlszeilenschnittstelle (CLI). Sie eignet sich ideal für Headless-Server, Entwickler-Terminals und Automatisierungs-Pipelines.

---

## Wichtige Unterbefehle

### 1. Dateien oder Verzeichnisse senden (Send)
Werden Pfade ohne expliziten Unterbefehl übergeben, startet EQT standardmäßig im Sendemodus:
```bash
# Einzelne Datei freigeben
eqt Dokument.pdf

# Mehrere Dateien mit Portangabe senden
eqt --port 8080 Video.mp4 Praesentation.pptx

# Komplettes Verzeichnis streamen (on-the-fly ZIP)
eqt /home/user/Projekte/
```

### 2. Dateien empfangen (Receive)
```bash
# Empfangsmodus starten und auf Uploads warten
eqt receive

# Zielverzeichnis definieren (Kurzoption -o)
eqt receive -o ~/Downloads
```

### 3. LAN-Kollaboration (Chat)
```bash
# Headless LAN-Zusammenarbeitsservice starten
eqt chat

# Chat-Dienst starten und automatisch im Browser öffnen
eqt chat --browser
```

### 4. Interaktiver Konfigurationsassistent (Config)
```bash
# Schnittstellen, Ports und Pfade im Terminal konfigurieren
eqt config
```

### 5. Shell-Autovervollständigung (Completion)
```bash
eqt completion bash > /etc/bash_completion.d/eqt
eqt completion zsh > "${fpath[1]}/_eqt"
```

---

## Globale CLI-Optionen

| Option | Kurz | Standard | Beschreibung |
| :--- | :---: | :---: | :--- |
| `--interface` | `-i` | Automatisch | Bindung an eine bestimmte Netzwerkschnittstelle erzwingen (z. B. `eth0`, `wlan0`, `Wi-Fi`) |
| `--port` | `-p` | `0` (Zufall) | Server-Port (`0` wählt einen freien Zufallsport) |
| `--bind` | | `0.0.0.0` | IP-Adresse für den Server-Bind (keine Kurzform) |
| `--browser` | `-b` | `false` | Webkonsole nach dem Start automatisch im Standardbrowser öffnen |
| `--secure` | `-s` | `true` | Vertrauenswürdige WebPKI HTTPS-Verschlüsselung aktivieren |
| `--output` | `-o` | Downloads | (Nur Empfangsmodus) Zielverzeichnis für empfangene Dateien |
| `--keep-alive` | `-k` | `false` | Prozess nach Übertragungsende weiterlaufen lassen |
| `--quiet` | `-q` | `false` | Fortschrittsbalken ausblenden, nur Fehler protokollieren |
| `--zip` | `-z` | `false` | Dateien vor dem Senden als einzelnes ZIP-Archiv bündeln |
| `--fqdn` | `-d` | Auto | Generierten Hostnamen/Domainnamen überschreiben |
| `--path` | | Zufallszeichen | Spezifischen URL-Präfix für Routen festlegen (z. B. `/mein-share`) |
| `--config` | `-c` | Standardpfad | Pfad zu externer YAML-Konfigurationsdatei |
| `--list-all-interfaces` | `-l` | `false` | Alle Netzwerkschnittstellen (inkl. virtueller Adapter) auflisten |
| `--reversed` | `-r` | `false` | Kontrast des Terminal-QR-Codes invertieren |
| `--tls-cert` | | Leer | Pfad zu eigenem TLS-Zertifikat (für isolierte Offline-Systeme) |
| `--tls-key` | | Leer | Pfad zu eigenem privaten TLS-Schlüssel (für isolierte Offline-Systeme) |
