---
name: eqt-deploy
description: Definitive guide and command registry for deploying EQT Cloudflare Pages (website, admin) and Workers (signal, drm-api).
---

# EQT Project Deployment Command Registry

This skill contains the authoritative Cloudflare project names, build directives, and deployment commands for all EQT cloud components.

> **CRITICAL RULE**: Never guess Cloudflare Pages project names or Workers names. Always use the registered `--project-name` values specified in this document.

---

## 1. Cloudflare Project Registry

| Component Name | Source Directory | Target Cloudflare Service | Exact Project Name | Custom Production Domain | Recommended Command |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **EQT Main Website** | `cloudflare/eqt-website` | Cloudflare Pages | **`eqt`** | `https://www.eqt.net.im/` | `npx wrangler pages deploy cloudflare/eqt-website --project-name=eqt --commit-dirty=true` |
| **EQT Pro P2P App** | `cloudflare/eqt-p2p-app` | Cloudflare Pages | **`eqt-p2p-app`** | `https://p.eqt.net.im/` | `npx wrangler pages deploy cloudflare/eqt-p2p-app --project-name=eqt-p2p-app --commit-dirty=true` |
| **EQT Admin Console**| `cloudflare/eqt-admin` | Cloudflare Pages | **`eqt-admin`** | `https://admin.eqt.net.im/` | `cd cloudflare/eqt-admin && npm run build && npx wrangler pages deploy dist --project-name=eqt-admin --commit-dirty=true` |
| **P2P Signal Worker**| `cloudflare/eqt-p2p-signal` | Cloudflare Worker | **`eqt-p2p-signal`** | `https://signal.eqt.net.im/` | `cd cloudflare/eqt-p2p-signal && npx wrangler deploy` |
| **DRM Auth Worker** | `cloudflare/eqt-drm-api` | Cloudflare Worker | **`eqt-drm-api`** | `https://lic.eqt.net.im/` | `cd cloudflare/eqt-drm-api && npx wrangler deploy` |

---

## 2. Deployment Instructions

### A. EQT Website (`cloudflare/eqt-website`)
- **Cloudflare Project Name**: `eqt`
- **Deploy Command**:
  ```sh
  npx wrangler pages deploy cloudflare/eqt-website --project-name=eqt --commit-dirty=true
  ```

### B. EQT Pro P2P App (`cloudflare/eqt-p2p-app`)
- **Cloudflare Project Name**: `eqt-p2p-app`
- **Deploy Command**:
  ```sh
  npx wrangler pages deploy cloudflare/eqt-p2p-app --project-name=eqt-p2p-app --commit-dirty=true
  ```

### C. EQT Admin (`cloudflare/eqt-admin`)
- **Cloudflare Project Name**: `eqt-admin`
- **Deploy Command**:
  ```sh
  npm --prefix cloudflare/eqt-admin run build
  npx wrangler pages deploy cloudflare/eqt-admin/dist --project-name=eqt-admin --commit-dirty=true
  ```

### D. EQT P2P Signal Worker (`cloudflare/eqt-p2p-signal`)
- **Deploy Command**:
  ```sh
  cd cloudflare/eqt-p2p-signal && npx wrangler deploy
  ```

---

## 3. Architecture Separation Guidelines

- **Website (`www.eqt.net.im`)**: Dedicated exclusively to commercial landing page, features, pricing, and compliance policies.
- **P2P Router Services**: Pro WAN transfer Shells (`p.eqt.net.im`) and signaling Worker (`signal.eqt.net.im`) serve P2P transfers cleanly on single production branch `main`.

