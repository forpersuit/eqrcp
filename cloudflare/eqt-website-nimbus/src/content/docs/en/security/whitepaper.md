---
title: "Security & Privacy Whitepaper"
description: "In-depth cryptographic architecture of EQT's peer-to-peer local streaming, zero cloud storage, and zero-leak LAN-TLS design."
---

# Security & Privacy Whitepaper

In an era where centralized cloud services and messaging platforms dominate data exchange, user privacy faces systemic vulnerabilities: cloud scanning of personal photos, unauthorized ingestion of confidential files into artificial intelligence models, and eavesdropping on unencrypted Wi-Fi networks.

From day one, EQT has adhered to a **"Privacy by First Principles & Physical Reality First"** engineering philosophy. This document publicly discloses EQT's security architecture and cryptographic design.

---

## Core Security Invariants

1. **Strict Zero Cloud Storage (Zero Cloud Relay)**:
   Whether streaming a 1 MB code snippet or a 100 GB raw video archive, the data payload flows exclusively through a direct physical network socket established between the sender and receiver. EQT operates zero file storage servers, zero external relays, and zero cloud caches.
2. **Zero-Leak Device Private Key**:
   The ECDSA P-256 private key required for local TLS encryption is generated physically on your desktop from high-entropy system randomness and saved with POSIX `0600` atomic file permissions. **The private key is never uploaded across the network.**
3. **Zero-Friction Mobile Sandbox with Ephemeral Cleanup**:
   Mobile devices interact strictly within the restricted sandboxes of native mobile browsers (iOS Safari, Android Chrome). Closing the browser tab terminates the execution context, leaving no persistent background daemons on mobile devices.

---

## LAN-TLS Protocol Architecture

### 1. Technical Flaws of Traditional Industry Solutions
In local peer-to-peer file transfer, "frictionless mobile usability" and "rigorous cryptographic security" have historically been in conflict:

| Approach | Operating Mechanism | Vulnerabilities & Security Evaluation |
| :--- | :--- | :--- |
| **Plaintext HTTP** | Direct transmission via `http://192.168.x.x` | ❌ **Trivially sniffed on open Wi-Fi**; triggers iOS Safari large-file (>1.5 GB) memory crashes. |
| **Self-Signed Certificates** | Ephemeral local CA certificate | ❌ **Triggers prominent browser security warnings**, training users to dangerously bypass certificate alerts. |
| **Cloud Relay** | File uploaded to cloud proxy servers | ❌ **Complete loss of privacy**; restricted by internet uplink speeds and cloud bandwidth throttling. |
| **Shared Wildcard Keys** | Bundled static wildcard cert & private key | ❌ **Disastrous pseudo-security**. The private key becomes a shared symmetric secret, enabling active LAN Man-in-the-Middle (MITM) attacks. |
| **EQT LAN-TLS (This System)** | **Let's Encrypt Device Wildcard + Stateless Loopback DNS** | ✅ **Zero private key leakage + Public WebPKI Green Lock 🔒 + Pure local physical wire speed**. |

---

### 2. EQT LAN-TLS Sequence Architecture

EQT unifies **local ECDSA key pair generation**, **serverless ACME DNS-01 challenge orchestration via Cloudflare Workers**, and **stateless mathematical authoritative loopback DNS (`eqt-dns`)**:

```
+---------------------------------------------------------------------------------------------------+
| 1. Client Local Key Generation (Workstation)                                                      |
|    - Desktop generates dedicated ECDSA P-256 private key; persisted with POSIX 0600 permissions. |
|    - Private key never leaves the machine; only the CSR is exported (*.<NodeID>.direct.eqt.net.im)|
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (1) POST CSR with anti-replay timestamp
                                                   v
+---------------------------------------------------------------------------------------------------+
| 2. Cloudflare ACME Gateway Orchestration (Serverless)                                             |
|    - Worker validates CSR signature and rate limits, submits NewOrder to CA (Let's Encrypt).      |
|    - Obtains DNS-01 TXT challenge token, writes temporary _acme-challenge to eqt-dns.             |
|    - Let's Encrypt verifies TXT record and issues X.509 cert chain; Worker purges TXT record.     |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (2) Return public certificate chain (fullchain.pem)
                                                   v
+---------------------------------------------------------------------------------------------------+
| 3. Local Service Initialization & Mobile Connection                                               |
|    - Workstation loads local privkey.pem and received cert.pem, binds TLS 1.3 socket.             |
|    - Mobile scans QR code pointing to: https://192-168-1-50.<NodeID>.direct.eqt.net.im:8080/      |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (3) Mobile initiates DNS query
                                                   v
+---------------------------------------------------------------------------------------------------+
| 4. Stateless Mathematical Loopback DNS (eqt-dns)                                                  |
|    - Authoritative DNS receives query, mathematically translates `192-168-1-50` in memory.        |
|    - Responds in <1 ms with A record 192.168.1.50 (TTL=300s); zero database lookups, zero logs.   |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (4) Direct LAN socket handshake
                                                   v
+---------------------------------------------------------------------------------------------------+
| 5. End-to-End TLS 1.3 LAN Wire-Speed Transfer                                                     |
|    - Mobile browser validates Let's Encrypt root trust: displays green padlock 🔒 without prompts.|
|    - High-throughput AEAD encryption (AES-GCM / ChaCha20-Poly1305); 100% data on local network.   |
+---------------------------------------------------------------------------------------------------+
```

---

### 3. Four Core Architectural Advantages

#### ① Cryptographic Zero Key Leakage (MITM Immune)
Every EQT workstation possesses a unique Node ID and generates its own cryptographic key pair locally. The certificate is issued strictly for `*.<NodeID>.direct.eqt.net.im`. **No shared or universal private keys exist across the network.** Even if untrusted third-party devices exist on the same LAN, they cannot decrypt or forge your session traffic.

#### ② Pure Mathematical Stateless Loopback DNS
The authoritative resolution cluster (`eqt-dns`) stores no user IP databases. It algorithmically decomposes prefixes like `192-168-1-50` into the physical internal IP `192.168.1.50` in memory. Queries respond in sub-millisecond time with infinite horizontal scalability.

#### ③ Official High-Quota Tier & Multi-CA Elastic Resilience
Standard ACME integrations face strict public CA rate limits (often 50 certificates per root domain per week). EQT operates under an official high-quota tier granted by Let's Encrypt, supporting over 20,000 certificate issuances weekly. Additionally, the orchestration layer includes intelligent Multi-CA failover circuits to guarantee global availability.

#### ④ Seamless Air-Gapped Fallback
When booting for the first time in an isolated network or air-gapped facility without internet connectivity, EQT automatically initializes an ephemeral fallback certificate so local transfers continue without interruption. Connecting to the internet subsequently triggers an automated background upgrade to the trusted public certificate.

---

## Memory Safety & Ephemeral Sessions

- **Zero-Tempfile Streaming**: When transmitting large folders, files are compressed into Zip chunks on-the-fly directly within memory network buffers. No unencrypted temporary files are written to physical disk.
- **RAM Ephemeral Chat Isolation**: Chat messages and clipboard contents reside strictly in volatile operating system memory (RAM). When the chat session terminates or the application closes, the memory allocations are immediately freed, leaving zero plaintext logs on persistent storage.
