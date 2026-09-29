---
title: "Häufig gestellte Fragen (FAQ)"
description: "Antworten zu Übertragungsgeschwindigkeit, Streaming-Kompression, Lizenzierung und Datenschutz bei EQT."
---

# Häufig gestellte Fragen (FAQ)

---

### F1: Welche Übertragungsgeschwindigkeit erreicht EQT?
**A**: Der Durchsatz hängt ausschließlich von Ihrer lokalen Netzwerkhardware, den verwendeten WLAN-Standards und der Schreibgeschwindigkeit Ihres Speichers ab. **Es gibt keinerlei künstliche Bandbreitendrosselung oder Cloud-Limits.**
- **Direkte physikalische Verbindung**: EQT setzt auf eine reine Peer-to-Peer-(P2P)-Socket-Architektur im LAN. Alle Daten fließen zu 100 % über Ihr lokales WLAN oder Netzwerkkabel.
- **Maximale Hardwareauslastung**: Die tatsächliche Geschwindigkeit wird durch Ihren WLAN-Standard (z. B. Wi-Fi 5 / Wi-Fi 6 / Wi-Fi 7), die Routerleistung und die Schreibgeschwindigkeit Ihres Flash-Speichers (NVMe SSD / UFS 4.0) bestimmt. Die Streaming-Engine von EQT ist so konzipiert, dass sie die physikalische Verbindungsgrenze voll ausschöpft.

---

### F2: Verbraucht die Übertragung mobiles Datenvolumen am Smartphone?
**A**: **Nein, für die Dateiinhalte wird keinerlei mobiles Datenvolumen verbraucht.**
Dateien werden ausschließlich über das interne lokale Netzwerk zwischen PC und Smartphone gestreamt. Lediglich bei der ersten DNS-Auflösung wird ein winziges Handshake-Signal (wenige Dutzend Bytes) übertragen.

---

### F3: Warum gibt es keine Wartezeit beim Senden ganzer Ordner?
**A**: EQT verfügt über eine eigens entwickelte **Echtzeit-Streaming-ZIP-Engine**.
Herkömmliche Programme müssen zunächst zeitraubend ein temporäres ZIP-Archiv auf der Festplatte anlegen. EQT liest Dateien fortlaufend ein, komprimiert sie im RAM und leitet die Chunks sofort an den aktiven Netzwerk-Socket weiter. Das Smartphone beginnt sofort nach dem Verbinden mit dem Download.

---

### F4: Wie übertrage ich eine Plus-Lizenz auf einen neuen Computer?
**A**:
1. Öffnen Sie das offizielle EQT-Selbstbedienungsportal.
2. Geben Sie Ihre Kauf-E-Mail-Adresse ein, um einen sicheren Anmeldetoken zu erhalten.
3. Klicken Sie in der Geräteübersicht neben dem bisherigen Computer auf „Trennen“.
4. Starten Sie EQT auf dem neuen Computer und geben Sie Ihren Lizenzschlüssel ein.

---

### F5: Was tun, wenn das Scannen des QR-Codes keinen Browser öffnet?
**A**:
- **iOS**: Verwenden Sie die vorinstallierte **Kamera-App**. Vermeiden Sie das Scannen in Drittanbieter-Apps, die Downloads blockieren.
- **Android**: Nutzen Sie die Standardkamera, Chrome oder Edge. Falls der Link in einer Drittanbieter-App geöffnet wird, tippen Sie oben rechts auf „In externem Browser öffnen“.
