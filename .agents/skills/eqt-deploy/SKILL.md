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
| **EQT Main Website** | `cloudflare/eqt-website` | Cloudflare Pages | **`eqt`** | `https://www.eqt.net.im/` | `npx wrangler pages deploy cloudflare/eqt-website --project-name=eqt` |
| **EQT Admin Console**| `cloudflare/eqt-admin` | Cloudflare Pages | **`eqt-admin`** | `https://admin.eqt.net.im/` | `cd cloudflare/eqt-admin && npm run build && npx wrangler pages deploy dist --project-name=eqt-admin --branch=master` |
| **P2P Signal Worker**| `cloudflare/eqt-p2p-signal` | Cloudflare Worker | **`eqt-p2p-signal`** | `https://signal.eqt.net.im/` | `cd cloudflare/eqt-p2p-signal && npx wrangler deploy` |
| **DRM Auth Worker** | `cloudflare/eqt-drm-api` | Cloudflare Worker | **`eqt-drm-api`** | `https://lic.eqt.net.im/` | `cd cloudflare/eqt-drm-api && npx wrangler deploy` |

---

## 2. Deployment Instructions

### A. EQT Website (`cloudflare/eqt-website`)
- **Cloudflare Project Name**: `eqt` (Do NOT use `eqt-website`)
- **Deploy Command**:
  ```sh
  npx wrangler pages deploy cloudflare/eqt-website --project-name=eqt
  ```

### B. EQT Admin (`cloudflare/eqt-admin`)
- **Cloudflare Project Name**: `eqt-admin`
- **Deploy Command**:
  ```sh
  npm --prefix cloudflare/eqt-admin run build
  npx wrangler pages deploy cloudflare/eqt-admin/dist --project-name=eqt-admin --branch=master
  ```

### C. EQT P2P Signal Worker (`cloudflare/eqt-p2p-signal`)
- **Deploy Command**:
  ```sh
  cd cloudflare/eqt-p2p-signal && npx wrangler deploy
  ```

---

## 3. Architecture Separation Guidelines

- **Website (`www.eqt.net.im`)**: Dedicated exclusively to commercial landing page, features, pricing, and compliance policies.
- **P2P Router Services**: Pro WAN transfer Shells should be served via dedicated Cloudflare Worker endpoints or isolated micro SPA apps (`p.eqt.net.im` or `eqt-p2p-signal` pure HTML output) to prevent domain redirect collisions and heavy website asset overhead.
