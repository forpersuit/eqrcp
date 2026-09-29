---
title: "Quickstart Guide"
description: "Learn how to transfer single files, multiple files, or entire directories between your computer and mobile devices in seconds."
---

# Quickstart Guide

EQT supports both an intuitive graphical user interface (GUI) and a high-performance command-line interface (CLI). To get started, simply ensure that your desktop and mobile devices are connected to the same local area network (same Wi-Fi or mobile hotspot).

---

## Mode 1: Share Mode (Computer ➔ Mobile Device)

Use this mode when you need to send videos, software packages, documents, or photos from your computer to a smartphone or tablet:

### 1. Desktop Operations
- **GUI**: Drag and drop files or folders directly into the EQT window, then click **Start Sending**.
- **CLI**:
  ```bash
  # Send a single file
  eqt MyDocument.pdf

  # Send multiple files or entire directories (streamed on-the-fly via Zip)
  eqt Photos/ Video.mp4
  ```

### 2. Mobile Device QR Scan
A dedicated QR code and a direct LAN URL will appear in your terminal or application window.
1. Open your device's native camera (iOS Camera or Android default scanner) and point it at the QR code.
2. Tap the notification banner to open the web portal in your mobile browser.
3. Tap **Download All** or select individual items to save them directly to your device.

---

## Mode 2: Receive Mode (Mobile Device ➔ Computer)

Use this mode when you need to backup photos, 4K videos, or mobile documents to your computer:

### 1. Start Receive Listener on Desktop
- **GUI**: Click the **Receive Files** tab in the main window, or select **Wait for Receive** from the system tray menu.
- **CLI**:
  ```bash
  eqt receive
  ```

### 2. Scan and Select Files on Mobile
1. Scan the displayed QR code with your mobile camera to open the upload portal.
2. Tap **Choose Files** or **Take Photo / Photo Library**.
3. Select the files you wish to transfer and tap **Send Now**.
4. The computer receives the files at the full physical wire speed of your LAN. Received files are saved in your system's default `Downloads` directory.

---

## Practical Tips

- **Real-Time Directory Streaming**: When sending an entire directory, EQT uses in-memory chunked Zip compression. You do not need to wait for a time-consuming pre-compression process; compression and transfer occur concurrently as soon as the client connects.
- **Custom Interfaces & Ports**: If your computer has multiple network adapters (such as physical Wi-Fi and virtual adapters), launch the interactive configuration wizard to select the desired network interface:
  ```bash
  eqt config
  ```
