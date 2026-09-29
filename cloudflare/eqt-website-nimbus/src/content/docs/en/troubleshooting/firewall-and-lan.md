---
title: "LAN Connectivity & Firewall"
description: "Troubleshoot connection timeouts, inaccessible pages, and network isolation issues when scanning the EQT QR code."
---

# LAN Connectivity & Firewall Troubleshooting

If scanning the QR code on mobile results in "Cannot connect to server," `ERR_CONNECTION_TIMED_OUT`, or an endless loading spinner, over 95% of cases are caused by **Windows Defender Firewall blocking inbound traffic** or **Router AP Isolation (Client Isolation)**.

Follow the step-by-step diagnostic procedures below:

---

## Step 1: Verify Both Devices Are on the Same Local Network

1. Ensure your computer and mobile device are connected to the **same Wi-Fi network name (SSID)**.
2. Beware of 2.4 GHz vs. 5 GHz band isolation: While most modern routers bridge both frequencies seamlessly, older router firmware may isolate 2.4 GHz and 5 GHz traffic. Connect both devices to the same frequency band if in doubt.
3. If your computer connects via a physical Ethernet cable while your mobile device is on Wi-Fi, ensure both belong to the same IP subnet (e.g., both assigned `192.168.1.x` addresses).

---

## Step 2: Configure Windows Defender Firewall (Most Common Cause)

Windows restricts inbound LAN connections by default when applications bind to network sockets.

### 1. Set Network Profile to "Private"
- Open Windows **Settings** ➔ **Network & Internet** ➔ **Properties**.
- Ensure the network profile is set to **Private Network**, not "Public Network." Public network profiles block virtually all inbound peer connections.

### 2. Allow EQT Through the Firewall
1. Press `Win + R`, type `firewall.cpl`, and press Enter to launch Windows Defender Firewall.
2. Click **Allow an app or feature through Windows Defender Firewall** in the left sidebar.
3. Click the **Change settings** button in the upper-right corner.
4. Locate **EQT** (or `eqt.exe`) in the application list. Ensure that **both** the **Private** and **Public** checkboxes are selected.
5. Click **OK** to save and apply the changes.

---

## Step 3: Check for Router AP Isolation (Client Isolation)

In enterprise offices, hotels, coffee shops, or guest Wi-Fi networks, routers often enable **AP Isolation (Client Isolation)**:
- **Symptom**: Both the computer and mobile device can access the public internet, but they cannot ping or establish direct TCP connections with each other.
- **Resolution**:
  - Log in to your router's administration panel and disable **AP Isolation** or **Station Separation** under advanced wireless settings;
  - Alternatively, in public venues without router access, enable **Personal Hotspot** on your smartphone and connect your computer to it. This creates a direct, isolated, high-speed Wi-Fi network.

---

## Step 4: Resolve Virtual Network Adapter Conflicts

If your workstation runs virtualization tools (VMware, VirtualBox, Docker Desktop, or VPN clients), multiple virtual network adapters will exist. EQT might inadvertently bind to a virtual host-only adapter instead of your physical Wi-Fi interface.

**Resolution**:
Run the interactive configuration wizard to explicitly select your physical wireless adapter:
```bash
eqt config
```
Select your active physical wireless adapter (typically labelled `Wi-Fi`, `WLAN`, or assigned an address such as `192.168.x.x`).
