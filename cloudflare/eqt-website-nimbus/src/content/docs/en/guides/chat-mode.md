---
title: "LAN Chat Collaboration"
description: "Synchronize cross-device clipboards, passwords, long URLs, and rich attachments with ephemeral peer-to-peer messaging."
---

# LAN Chat Collaboration Mode

During daily workflows, engineers and creators frequently need to synchronize text snippets between mobile and desktop devices:
- A shipping address, tracking code, or 2FA verification code received on desktop needed on mobile;
- An account password, API secret, or SSH command copied on a phone that must be pasted into a desktop terminal;
- Traditional chat applications often compress photo/video fidelity and upload confidential text to third-party cloud servers.

EQT **Chat Mode** is engineered specifically for this need: an ephemeral, zero-friction local messaging room that requires no client installation, launches instantly, and burns all data upon session termination.

---

## Launching Chat Mode

### 1. Launch on Desktop
Click **LAN Chat** in the desktop application, or execute the following command in your terminal:
```bash
eqt chat --browser
```
This starts the local collaboration server, opens the desktop management dashboard, and displays the mobile QR access code.

### 2. Connect from Mobile
Scan the QR code with your mobile camera to enter the web-based chat room directly. No account registration or login is required.

---

## Key Features

### 1. Bi-directional Real-Time Clipboard Sync
- Long-press to copy text on mobile and send it through the chat; it appears instantly on desktop with a one-click **Copy to Clipboard** button.
- Full support for multi-line code blocks, Markdown formatting, and long URLs without truncation.

### 2. Multi-File & Rich Media Attachments
- Send original-resolution photos, 4K video clips, and documents at any time during the conversation.
- Attachments are transferred directly over concurrent local area network sockets with zero compression.

### 3. Host Access Control
- The desktop instance acts as the authoritative host, displaying a real-time list of all connected LAN clients.
- One-click client eviction allows you to immediately disconnect unauthorized or unknown devices.

### 4. Ephemeral "Burn After Reading" Memory Isolation
- As soon as the chat window is closed or the process terminates, the entire conversation is purged from volatile system RAM. No unencrypted plaintext history is ever saved to persistent disk storage.

### 5. Quota & Usage Policies
- **Text & Clipboard Messages**: Permanently free and unrestricted, with zero message limits or time restrictions.
- **Rich Media & Attachments**: Free tier includes 5 minutes (300 seconds) of daily full-speed attachment transfers. Once the quota is exhausted, transfers gracefully step down to a safety channel (max 4 MB per file, 100 KB/s), while text chat continues uninterrupted. Upgrading to Plus unlocks 24/7 unlimited wire-speed transfers without file size boundaries.
