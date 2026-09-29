---
title: "Edition Comparison (Free vs Plus)"
description: "Understand the differences between EQT Free and Plus editions, including quotas, boundaries, and offline policies."
---

# Edition Comparison: Free vs. Plus

EQT is designed around a dual-tier philosophy: **"Free tier handles casual daily utility, while Plus tier unlocks unconstrained productivity for power users and creators."** Both tiers share the exact same underlying architecture: 100% peer-to-peer local streaming with zero compromise on privacy.

---

## Feature Comparison Table

| Feature | Free Edition | Plus Edition (Recommended) |
| :--- | :---: | :---: |
| **Data Privacy** | 100% local direct, 0 bytes to cloud | 100% local direct, 0 bytes to cloud |
| **Mobile Experience** | Native camera scan, zero app installation | Native camera scan, zero app installation |
| **Basic File Transfers** | 5 full-speed transfers daily | **Unlimited transfers & volume** |
| **File Size Limit (Post-Quota)** | Max 50 MB / file (up to 5 files / batch) | **Completely unlocked (100 GB+ supported)** |
| **Concurrent Devices** | 1–2 concurrent LAN devices | **Unlimited concurrent connections** |
| **LAN Chat (Text & Clipboard)** | **Permanently free & unlimited** | **Permanently free & unlimited** |
| **Chat Attachments** | 5 mins (300s) daily full-speed; fallback to 100 KB/s (4 MB/file) | **24/7 unlimited wire-speed direct transfers** |
| **LAN-TLS Green Lock** | Let's Encrypt automated certificate support | Complete stateless loopback WebPKI green lock |
| **Air-Gapped Offline Operation** | Requires internet connectivity for validation | **Up to 7 days (168 hours) fully offline** |
| **Updates & Support** | Community releases & public docs | **Priority support & early access updates** |

---

## Detailed Policy Mechanics

### 1. Why Does the Free Tier Have Lightweight Boundaries?
Developing and maintaining high-performance cross-platform networking—including automated ACME DNS-01 orchestration, iOS WebKit streaming write engines, and multi-NIC binding—requires ongoing engineering investment:
- Occasional transfers of documents, PDFs, or photos easily fit within the daily free allocation;
- High-volume creative workflows (e.g., 4K video footage transfer, VM image deployment, enterprise collaborative drafting) benefit from the unconstrained throughput of Plus.

### 2. Plus Offline Policy
Once activated with an initial online sync, a Plus license operates **completely offline in air-gapped environments for up to 7 days (168 hours)**:
- Full access to all professional features remains uninterrupted during flights, secure server rooms, or off-grid field sites;
- Connecting to the internet once within 7 days automatically triggers a silent background re-validation, renewing the 7-day offline counter without interrupting active transfers.
