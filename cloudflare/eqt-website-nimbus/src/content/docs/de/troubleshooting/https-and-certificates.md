---
title: "HTTPS- und Zertifikatsleitfaden"
description: "Funktionsweise der lokalen HTTPS-Verschlüsselung von EQT, Notwendigkeit von Zertifikaten, Let's Encrypt und Offline-Fallback."
---

# HTTPS-Schloss und Zertifikatsleitfaden

Beim Scannen des EQT-QR-Codes im mobilen Browser sehen Sie in der Adressleiste ein vertrauenswürdiges grünes Sicherheitsschloss (🔒). Dieser Leitfaden erläutert die kryptografischen Grundlagen und Diagnoseschritte des LAN-TLS-Systems von EQT.

---

## Warum lokale Netzwerkübertragungen zwingend HTTPS erfordern

Herkömmliche LAN-Tools stellten Dateien über unverschlüsseltes `http://` bereit. In modernen Betriebssystemen und Browsern unterliegt unverschlüsseltes HTTP jedoch extremen technischen Restriktionen:

### 1. Die iOS-Safari 1,5-GB-Speicherfalle (OOM-Absturz)
In unverschlüsselten `http://`-Sitzungen erzwingt die WebKit-Sandbox von Apple strenge Beschränkungen: Sie untersagt das direkte Schreiben von Streaming-Daten auf den Gerätespeicher und sammelt eingehende Chunks stattdessen im RAM des Browsers. Wird eine Datei über 1,5 GB bis 2 GB via Klartext-HTTP übertragen, läuft der Safari-Speicher (Heap) voll und der Tab stürzt sofort ab (Out-of-Memory). **Erst in einem authentifizierten HTTPS-Kontext erlaubt WebKit uneingeschränktes Streaming direkt auf den Datenträger.**

### 2. Restriktionen moderner Web-APIs
Gemäß W3C-Spezifikationen sind Funktionen wie der automatische Zugriff auf die Zwischenablage, das native Freigabemenü (Web Share API) und hardwarebeschleunigte Web Crypto APIs ausschließlich in einem **sicheren Kontext (HTTPS)** erlaubt und werden unter einfachem HTTP vom Browser blockiert.

### 3. Schutz vor Lauschangriffen im WLAN
In offenen WLAN-Netzwerken (Cafés, Hotels, Coworking) kann unverschlüsselter HTTP-Datenverkehr mühelos mit einfachen Paketanalysetools mitgeschnitten werden, wodurch private Fotos und vertrauliche Dokumente offengelegt werden.

---

## Wie EQT ein öffentliches WebPKI-Schloss im lokalen Netzwerk bereitstellt

1. **Dedizierte Let's Encrypt Wildcard-Zertifikate**:
   Beim ersten Start generiert der Desktop-Client lokal ein ECDSA P-256-Schlüsselpaar. Über Cloudflare-Serverless-Orchestrierung besteht er eine ACME DNS-01-Prüfung mit **Let's Encrypt** und erhält ein gerätespezifisches Wildcard-Zertifikat (`*.<NodeID>.direct.eqt.net.im`).
2. **Zustandsloses mathematisches Loopback-DNS (`eqt-dns`)**:
   Wenn ein Smartphone `https://192-168-1-50.<NodeID>.direct.eqt.net.im:8080/` aufruft, übersetzt der autoritative DNS-Server den Präfix rein rechnerisch im Arbeitsspeicher in die lokale IP `192.168.1.50`.
3. **Öffentliches Stammzertifikat-Vertrauen + Direkte WLAN-Übertragung**:
   Der Browser validiert das Zertifikat gegen den integrierten Let's Encrypt-Vertrauensspeicher und zeigt das grüne Schloss an. Gleichzeitig fließen **100 % aller TCP-Pakete direkt über den lokalen Router oder Switch**, völlig isoliert vom Internet.
