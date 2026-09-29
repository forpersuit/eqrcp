---
title: "Sicherheits- & Datenschutz-Whitepaper"
description: "Detaillierte kryptografische Architektur von EQT: Direkte P2P-Verbindungen, kein Cloud-Speicher und lecksicheres LAN-TLS."
---

# Sicherheits- & Datenschutz-Whitepaper

In einer Zeit, in der zentrale Cloud-Dienste und Messaging-Plattformen den Datenaustausch dominieren, ist die Privatsphäre der Nutzer systemischen Risiken ausgesetzt: Automatisierte Scans privater Fotos, ungefragtes Training von KI-Modellen mit vertraulichen Arbeitsdateien und Lauschangriffe auf unverschlüsselten WLAN-Verbindungen.

EQT folgt seit der ersten Codezeile einer klaren Philosophie: **„Datenschutz nach First Principles und physikalische Realität an erster Stelle (Privacy by First Principles & Physical Reality First)“**. Dieses Dokument legt die Sicherheitsarchitektur und das kryptografische Design von EQT offen.

---

## 3 fundamentale Sicherheitsinvarianten

1. **Strikter Verzicht auf Cloud-Speicher (Zero Cloud Relay)**:
   Ob ein 1-MB-Codefragment oder ein 100-GB-Rohvideoarchiv – die Daten fließen ausschließlich über einen direkten physikalischen Socket zwischen Sender und Empfänger. EQT betreibt weder Dateispeicher-Server noch Relays oder Caches im Internet.
2. **Keinerlei Abfluss des privaten Schlüssels**:
   Der für die lokale TLS-Verschlüsselung erforderliche private ECDSA P-256-Schlüssel wird auf Ihrem Rechner mit hoher Systementropie generiert und mit POSIX `0600`-Dateiberechtigungen geschützt. **Der private Schlüssel verlässt das Gerät unter keinen Umständen.**
3. **Flüchtige Sitzungen in der mobilen Sandbox**:
   Mobilgeräte agieren ausschließlich innerhalb der standardmäßigen Sandbox mobiler Browser (iOS Safari, Android Chrome). Beim Schließen des Browser-Tabs wird der gesamte Ausführungskontext zerstört; es bleiben keinerlei Hintergrunddienste auf dem Smartphone zurück.

---

## Architektur des LAN-TLS-Protokolls

### 1. Technische Schwächen bisheriger Branchenlösungen
Bei lokalen Dateiübertragungen standen Benutzerfreundlichkeit und kryptografische Sicherheit lange im Widerspruch:

| Ansatz | Funktionsweise | Schwachstellen & Sicherheitsbewertung |
| :--- | :--- | :--- |
| **Klartext-HTTP** | Übertragung über `http://192.168.x.x` | ❌ **Im offenen WLAN mitlesbar**; verursacht Speicherabstürze in iOS Safari bei Dateien >1,5 GB. |
| **Selbstsignierte Zertifikate** | Lokale temporäre Zertifizierungsstelle | ❌ **Erzwingt beängstigende Sicherheitswarnungen** im Browser und gewöhnt Nutzer daran, Zertifikatsfehler zu ignorieren. |
| **Cloud-Relay** | Hochladen auf externe Proxy-Server | ❌ **Vollständiger Verlust der Privatsphäre**; limitiert durch Internet-Uploadraten und Bandbreitendrosselung. |
| **Geteilte Wildcard-Schlüssel** | Integriertes statisches Zertifikat samt privatem Schlüssel | ❌ **Fatale Pseudosicherheit**. Der private Schlüssel wird zum geteilten Geheimnis und ermöglicht Man-in-the-Middle-Angriffe (MITM) im lokalen Netz. |
| **EQT LAN-TLS (Unser System)** | **Dediziertes Let's Encrypt-Zertifikat + Zustandsloses DNS** | ✅ **Kein Schlüsselabfluss + Öffentliches WebPKI-Schloss 🔒 + Maximale physikalische Leitungsgeschwindigkeit**. |

---

### 2. Ablaufdiagramm der LAN-TLS-Architektur

EQT kombiniert **lokale ECDSA-Schlüsselgenerierung**, **Serverless ACME DNS-01-Orchestrierung via Cloudflare Workers** und **zustandsloses mathematisches Loopback-DNS (`eqt-dns`)**:

```
+---------------------------------------------------------------------------------------------------+
| 1. Lokale Schlüsselgenerierung am Arbeitsplatzrechner                                             |
|    - Erzeugt dedizierten ECDSA P-256-Schlüssel mit POSIX 0600-Berechtigungen.                     |
|    - Privater Schlüssel bleibt lokal; nur der CSR (*.<NodeID>.direct.eqt.net.im) wird exportiert.|
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (1) POST des CSR mit Replay-Schutz-Zeitstempel
                                                   v
+---------------------------------------------------------------------------------------------------+
| 2. Cloudflare ACME-Gateway (Serverless)                                                           |
|    - Worker validiert Signatur und Rate-Limits, platziert Auftrag bei Let's Encrypt.               |
|    - Erhält DNS-01-TXT-Challenge-Token und trägt temporären Record in eqt-dns ein.                |
|    - Let's Encrypt prüft TXT-Eintrag und stellt Zertifikat aus; Worker löscht TXT-Record sofort.  |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (2) Öffentliche Zertifikatskette (fullchain.pem) zurück
                                                   v
+---------------------------------------------------------------------------------------------------+
| 3. Lokale Dienstinitialisierung & Smartphone-Verbindung                                           |
|    - Rechner bindet TLS 1.3-Socket mit lokalem Schlüssel und Zertifikat.                          |
|    - Smartphone scannt QR-Code: https://192-168-1-50.<NodeID>.direct.eqt.net.im:8080/            |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (3) Smartphone sendet DNS-Anfrage
                                                   v
+---------------------------------------------------------------------------------------------------+
| 4. Zustandsloses mathematisches Loopback-DNS (eqt-dns)                                            |
|    - Server übersetzt Präfix `192-168-1-50` rein rechnerisch im RAM in die LAN-IP 192.168.1.50.  |
|    - Antwortet in <1 ms mit A-Record 192.168.1.50 (TTL=300s); keine Datenbank, keine Protokolle.  |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (4) Direkter lokaler Socket-Handshake (LAN)
                                                   v
+---------------------------------------------------------------------------------------------------+
| 5. Ende-zu-Ende TLS 1.3-Übertragung mit voller Leitungsgeschwindigkeit                            |
|    - Mobiler Browser validiert Let's Encrypt-Vertrauenskette: Grünes Schloss 🔒 ohne Warnung.    |
|    - Hochdurchsatz-AEAD-Verschlüsselung (AES-GCM / ChaCha20-Poly1305); 100 % lokaler Datenfluss. |
+---------------------------------------------------------------------------------------------------+
```

---

### 3. Vier entscheidende Architekturvorteile

#### ① Kryptografisch lecksichere Schlüssel (Immun gegen MITM-Angriffe)
Jeder EQT-Rechner besitzt eine eindeutige Node-ID und generiert sein eigenes Schlüsselpaar. Das Zertifikat wird ausschließlich für `*.<NodeID>.direct.eqt.net.im` ausgestellt. **Es existieren keinerlei universelle oder geteilte private Schlüssel im Netz.**

#### ② Reine mathematische Zustandslosigkeit
Das DNS-Cluster (`eqt-dns`) speichert keine IP-Adressen von Benutzern. Es dekodiert Präfixe wie `192-168-1-50` on-the-fly im Speicher in Millisekundenbruchteilen mit unbegrenzter horizontaler Skalierbarkeit.

#### ③ Offizielles High-Quota-Kontingent & Multi-CA-Ausfallsicherheit
EQT verfügt über ein erweitertes offizielles Let's Encrypt-Kontingent von über 20.000 Neuausstellungen pro Woche, kombiniert mit automatischen Ausweichmechanismen auf sekundäre CAs.

#### ④ Nahtloser Offline-Betrieb (Air-Gap)
Wird EQT erstmals in einem isolierten Netzwerk ohne Internetzugang gestartet, generiert es ein temporäres Ausweichzertifikat, um die lokale Übertragung aufrechtzuerhalten, und führt das Upgrade auf das öffentliche Zertifikat im Hintergrund durch, sobald eine Internetverbindung besteht.
