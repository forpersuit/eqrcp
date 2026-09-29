---
title: "Frequently Asked Questions"
description: "Frequently asked questions regarding EQT transfer performance, streaming compression, license management, and privacy."
---

# Frequently Asked Questions (FAQ)

---

### Q1: What transfer speed can EQT achieve?
**A**: Transfer throughput depends entirely on your local network hardware, wireless protocol generation, and storage I/O performance. **There is zero artificial or cloud-based bandwidth throttling.**
- **Physical Direct Link**: EQT utilizes a pure peer-to-peer (P2P) local socket streaming architecture. All data travels 100% across your local Wi-Fi or wired network, completely bypassing external cloud bottlenecks.
- **Maximum Hardware Saturation**: Real-world transfer speeds are governed by your devices' Wi-Fi generation (e.g., Wi-Fi 5 / Wi-Fi 6 / Wi-Fi 7), router backplane capacity, and flash storage (NVMe SSD / UFS 4.0) write speeds. EQT's chunked streaming engine is engineered to saturate the maximum physical line speed of your local link.

---

### Q2: Does transferring files consume mobile cellular data?
**A**: **No cellular data is consumed for file payloads.**
Files stream directly across the internal local network between your computer and mobile device. Only a negligible handshake signal (a few dozen bytes) is sent during initial DNS resolution. If desired, you may disable cellular data on your phone after scanning the QR code to verify.

---

### Q3: Why is there no delay when sending entire directories?
**A**: EQT incorporates an in-house **real-time streaming Zip engine**.
Traditional utilities require pre-compressing all files into a temporary archive on disk before sending, which consumes minutes and massive disk space. EQT reads file streams, applies compression, and pushes chunks into the active network socket concurrently. Mobile devices begin downloading the archive immediately upon connection.

---

### Q4: How do I transfer a Plus license to a new computer?
**A**:
1. Navigate to the official EQT Self-Service Portal;
2. Enter your purchase email address to receive a secure dynamic login token;
3. In the device management dashboard, click **Unbind** next to the retired workstation;
4. Open EQT on your new computer and input your license redemption code to activate.

---

### Q5: What should I do if scanning the QR code does not launch a browser?
**A**:
- **Apple iOS**: Use the built-in system **Camera** app. Tap the yellow URL pop-up banner to open the portal in native Safari. Avoid scanning within third-party apps that sandbox file downloads or restrict downloads.
- **Android**: Use the system camera, Chrome, Edge, or the native browser. If scanned inside a third-party app, tap the top-right menu and choose **Open in external browser**.

---

### Q6: Who issues the HTTPS certificates used for LAN transfers?
**A**:
EQT's dedicated device certificates are automatically provisioned by **Let's Encrypt**, supported by an official high-quota tier and an intelligent Multi-CA failover layer.
Because private keys are generated strictly on your local machine and never leave the device, EQT provides both WebPKI green lock trust and complete cryptographic privacy.
