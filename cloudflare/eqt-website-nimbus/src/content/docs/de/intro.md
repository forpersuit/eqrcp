---
title: "Produktübersicht"
description: "EQTs grundlegende Designphilosophie, direkte LAN-Architektur, vollständiger Verzicht auf Cloud-Speicher und Hauptfunktionen."
---

# Willkommen im EQT Dokumentationszentrum

EQT (Easy QR Transfer) ist ein plattformübergreifendes System für ultraschnelle Direktübertragungen und Echtzeit-Kollaboration im lokalen Netzwerk (LAN), das von Grund auf nach **First Principles** entwickelt wurde.

Bei der Verwendung traditioneller zentraler Cloud-Dienste oder Messaging-Plattformen entstehen unweigerlich Sicherheits- und Leistungsprobleme: Scannen privater Fotos, ungefragtes Training von KI-Modellen mit vertraulichen Dokumenten, Bandbreitenbeschränkungen beim Internet-Upload und Qualitätsverlust durch Medienkomprimierung. EQT löst diese Probleme an der Wurzel, indem es Daten direkt, sicher und mit maximaler Geschwindigkeit zwischen Geräten im selben lokalen Netzwerk austauscht.

---

## Grundlegende Konstruktionsprinzipien

- **Übertragung mit maximaler Leitungsgeschwindigkeit (Zero Cloud Relay)**:
  Sender und Empfänger bauen einen direkten lokalen Netzwerk-Socket auf. Daten fließen vollständig über Ihren lokalen WLAN-Router oder Switch – ohne Umweg über externe Cloud-Server.
- **Keine App-Installation auf Mobilgeräten (Zero App Needed)**:
  Empfangende Smartphones (iOS / Android) scannen einfach den QR-Code mit der Standard-Kamera-App und übertragen Dateien direkt im Browser.
- **Echte LAN-TLS-Verschlüsselung (WebPKI Green Lock)**:
  Durch die Kombination von Let's Encrypt mit zustandslosem mathematischem Loopback-DNS erhalten Sie eine nahtlose HTTPS-Verbindung mit dem offiziellen vertrauenswürdigen grünen Schloss (🔒) ohne störende Sicherheitswarnungen.
- **Echtzeit-Streaming-ZIP-Komprimierung im Speicher**:
  Beim Senden ganzer Verzeichnisse oder hunderter Einzeldateien wird keine temporäre Archivdatei auf der Festplatte erstellt. EQT komprimiert Datenblöcke direkt im Arbeitsspeicher und leitet sie unmittelbar in den Netzwerk-Socket weiter.

---

## Struktur der Dokumentation

1. **[Schnellstartanleitung](/de/guides/quickstart)**: Vom Desktop-Start bis zur mobilen Dateiübertragung in wenigen Schritten.
2. **[LAN-Kollaboration (Chat-Modus)](/de/guides/chat-mode)**: Sichere Textnotizen und Dateiaustausch in Konferenzräumen und Büros.
3. **[Free vs. Plus Vergleich](/de/guides/free-vs-plus)**: Funktionsumfang der kostenlosen Version und der Plus-Lizenz.
4. **[Fehlerbehebung](/de/troubleshooting/firewall-and-lan)**: Firewall-Freigaben, HTTPS-Zertifikatsdiagnose und häufig gestellte Fragen (FAQ).
5. **[CLI-Handbuch](/de/cli/commands)**: Befehlszeilenwerkzeuge und Konfigurationsdateien für Server und NAS-Systeme.
6. **[Sicherheits-Whitepaper](/de/security/whitepaper)**: Kryptografische Architektur, Schlüsselisolation und Datenschutzgarantien.
