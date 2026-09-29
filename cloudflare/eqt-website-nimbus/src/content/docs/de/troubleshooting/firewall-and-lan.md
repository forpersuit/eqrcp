---
title: "Fehlerbehebung: Firewall und Netzwerk"
description: "Geräteerkennung im lokalen Netzwerk, Deaktivierung der AP-Isolation (Gast-WLAN) und Firewall-Konfiguration."
---

# Fehlerbehebung: Firewall und lokales Netzwerk

Wenn der mobile Browser nach dem Scannen des QR-Codes die Seite nicht laden kann oder ein Verbindungs-Timeout anzeigt, liegt dies meist an Sicherheitseinstellungen im Router oder an der Desktop-Firewall.

---

## 1. AP-Isolation (Client-Isolation) im Router prüfen

In Hotel-, Gast- oder manchen Büro-Netzwerken ist häufig die sogenannte **AP-Isolation (Client Isolation)** aktiviert.
Diese Sicherheitsfunktion verhindert gezielt, dass verbundene Geräte im selben WLAN direkt miteinander kommunizieren können.

- **Lösung**: Deaktivieren Sie in den Router-Einstellungen Optionen wie „AP-Isolation“, „Client-Isolation“ oder „WLAN-Geräte dürfen untereinander kommunizieren“, oder wechseln Sie in das reguläre Haupt-WLAN.

---

## 2. Windows Defender Firewall freigeben

Beim ersten Start von EQT unter Windows erscheint eine Sicherheitsabfrage. Hier muss der Zugriff für „Private Netzwerke“ gestattet werden.

Falls der Zugriff versehentlich verweigert wurde:
1. Öffnen Sie die **Windows-Einstellungen** ➔ **Datenschutz und Sicherheit** ➔ **Windows-Sicherheit** ➔ **Firewall & Netzwerkschutz**.
2. Klicken Sie auf **App durch Firewall zulassen**.
3. Suchen Sie den Eintrag `EQT` und aktivieren Sie das Kontrollkästchen für „Privat“.

---

## 3. macOS: Lokale Netzwerkberechtigung erteilen

Ab macOS Sequoia (15.0) verlangt das Betriebssystem eine explizite Bestätigung, wenn Programme mit Geräten im lokalen Netzwerk kommunizieren möchten.

1. Öffnen Sie die **Systemeinstellungen** ➔ **Datenschutz & Sicherheit** ➔ **Lokales Netzwerk**.
2. Aktivieren Sie den Schalter neben `EQT`.
