---
title: "HTTPS & Certificate Guide"
description: "Understand EQT's local HTTPS encryption, why certificates are mandatory, Let's Encrypt issuance, and offline fallbacks."
---

# HTTPS Green Lock & Certificate Guide

When scanning an EQT QR code with a mobile browser, users often notice the trusted green security lock (🔒) in the URL bar, or occasionally encounter a certificate prompt in air-gapped setups. This guide explains the cryptographic principles and operational diagnostics of EQT's LAN-TLS system.

---

## Why Local Area Network Transfers Require HTTPS

Legacy LAN tools typically serve content over unencrypted `http://`. In modern operating systems and browser security models, plaintext HTTP imposes severe technical constraints:

### 1. The iOS Safari 1.5 GB Memory Trap (OOM Crash)
In unencrypted `http://` contexts, Apple iOS WebKit sandboxing enforces strict security policies: it terminates direct file write streams to storage and diverts all incoming data chunks into browser volatile memory. When transferring files larger than 1.5 GB to 2 GB over plaintext HTTP, the Safari mobile tab exhausts its heap allocation and crashes immediately (Out-Of-Memory). **Only within an authenticated HTTPS context does WebKit grant full streaming direct-to-disk write privileges.**

### 2. Modern Web Platform API Restrictions
W3C specifications mandate a **Secure Context (HTTPS)** for core capabilities. Automated clipboard synchronization, the native mobile share sheet (Web Share API), and hardware-accelerated Web Crypto APIs are strictly disabled by browsers when loaded over plain HTTP.

### 3. Protection Against Local Wi-Fi Eavesdropping
On open coffee shop, hotel, or shared office Wi-Fi networks, anyone running basic packet capture utilities can effortlessly intercept unencrypted HTTP transfers, exposing personal photos, work documents, and chat records.

---

## How EQT Achieves a Public WebPKI Green Lock on Local Networks

Users often ask: *"If data is transmitted entirely across a local area network, how does the browser show a legitimate, publicly trusted security lock?"*

1. **Dedicated Let's Encrypt Wildcard Certificates**:
   On its initial launch, the desktop client generates an ECDSA P-256 private key locally. Through Cloudflare-coordinated serverless automation, it completes an ACME DNS-01 challenge with **Let's Encrypt**, provisioning a dedicated wildcard certificate (`*.<NodeID>.direct.eqt.net.im`) for that specific device. This channel is backed by official high-quota capacity (20,000+ certificates/week) with intelligent Multi-CA failover resilience.
2. **Stateless Mathematical Loopback DNS (`eqt-dns`)**:
   When a mobile device scans a link like `https://192-168-1-50.<NodeID>.direct.eqt.net.im:8080/`, the authoritative DNS cluster mathematically transforms the prefix into the LAN IP `192.168.1.50` entirely in memory.
3. **Public Root CA Trust + Direct Wi-Fi Switching**:
   The mobile browser validates the certificate against its built-in Let's Encrypt root trust store, displaying the green lock. Meanwhile, **100% of TCP data packets travel strictly over the local Wi-Fi router or switch**, completely bypassing external servers.

---

## Symptoms & Diagnostics

### Symptom 1: Address Bar Displays Trusted Lock 🔒
This is the standard operational state. Certificates are valid for 90 days, and the desktop client automatically and silently renews them in the background prior to expiration. No manual action is required.

### Symptom 2: Browser Displays "Connection is not private / Invalid Certificate"
This generally arises from one of two scenarios:
- **Scenario A: EQT Was Launched Initially Without Internet Access**
  If EQT was launched on a workstation in a completely air-gapped environment, it could not communicate with Let's Encrypt and instead generated an ephemeral self-signed certificate to maintain availability.
  *Resolution*: Connect the computer to the internet once, restart EQT, and allow a few seconds for the initial certificate provisioning to complete.
- **Scenario B: Intranet DNS Hijacking or Split-Horizon DNS**
  In corporate environments where public DNS resolution is blocked or redirected to an internal resolver, the browser may fail to resolve the loopback domain.
  *Resolution*: On the browser warning page, tap **Advanced** ➔ **Proceed to Site (Unsafe)**. Full local peer-to-peer data transfer functionality will operate normally.
