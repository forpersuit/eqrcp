---
name: eqt-admin
description: Guidelines for EQT Admin management console development, Cloudflare Pages deployment, and Chrome MCP DevTools E2E verification.
---

# EQT Admin Development, Deployment & E2E Verification Skill

This skill defines standard operating procedures for editing, building, deploying, and E2E testing the Cloudflare-hosted EQT Admin system (`cloudflare/eqt-admin`).

---

## 1. Module Overview & Project Architecture

* **Source Directory**: `cloudflare/eqt-admin`
* **Framework**: Svelte 5 + Vite + TypeScript + Vanilla CSS Design System (`src/app.css`)
* **Functions & Auth**: Cloudflare Access JWT validation via `functions/api/[[path]].ts` proxying to `lic.eqt.net.im`.
* **Core Pages**:
  - **Overview (`Overview.svelte`)**: High-level KPIs, D1 database status, quick modules entrance.
  - **Pro P2P (`ProP2P.svelte` + `p2p-globe.html`)**: Real-time 3D WebRTC topology screen (WebGL hardware accelerated with 2D fallback), active rooms table, force-kill room API.
  - **Feedbacks (`Feedbacks.svelte`)**: User feedback submissions, bug reports, and attachment inspection.
  - **Error Audit (`ErrorAudit.svelte`)**: Highlighting critical D1 system error logs and stack traces.
  - **Ops Audit (`OpsAudit.svelte`)**: Admin write-operation audit trails and source IPs.
  - **Licenses (`Licenses.svelte`)**: Full database license query, manual issuance, revocation, and device unbinding.
  - **Blacklist (`Blacklist.svelte`)**: Email and hardware fingerprint ban/unban management.
  - **System Health (`SystemHealth.svelte`)**: SMTP/Paddle probes, configuration readiness, fulfillment events timeline.

---

## 2. Mandatory Build & Deployment Workflow

Whenever changes are made to `cloudflare/eqt-admin`:

### Step 1: Local Verification & Build
Always run local compilation first to catch any Svelte/Vite errors, missing public assets (like `p2p-globe.html`), or type mismatches:

```sh
npm --prefix cloudflare/eqt-admin run build
```

Verify that `dist/index.html` and `dist/p2p-globe.html` are cleanly generated without build warnings or missing bundles.

### Step 2: Cloudflare Pages Production Deployment
Deploy the compiled static bundle (`dist/`) and Workers Functions (`functions/`) directly to Cloudflare Pages production branch (`master`):

#### Method A: Run directly inside `cloudflare/eqt-admin` root directory (Recommended):
```sh
cd cloudflare/eqt-admin
npm run build
npx wrangler pages deploy dist --project-name eqt-admin --branch master
```

#### Method B: Run from repository root:
```sh
npm --prefix cloudflare/eqt-admin run build
npx wrangler pages deploy cloudflare/eqt-admin/dist --project-name eqt-admin --branch master
```

> **Note**: Standard `wrangler pages deploy` without `--branch master` publishes to preview branches (`*.pages.dev`). Always specify `--branch master` for production releases to update the official custom domain `https://admin.eqt.net.im/` instantly.

---

## 3. Chrome DevTools MCP E2E Verification Workflow

After every update and deployment to the Admin system, perform an automated E2E simulation using `chrome-devtools-mcp` tools strictly targeting the official production domain (`https://admin.eqt.net.im/`). Do NOT verify preview `.pages.dev` URLs.

### E2E Test Execution Steps:

1. **Target Selection**:
   - **Official Production Domain**: Target `https://admin.eqt.net.im/` (do not test `.pages.dev` previews).

2. **Navigate & Page Selection**:
   - Use `chrome-devtools-mcp`'s `navigate_page` to open `https://admin.eqt.net.im/`.

3. **Verify Tab Navigation & Page Render**:
   - Click/evaluate navigation buttons (`.nav-item`) to verify each tab loads cleanly without unhandled JavaScript exceptions:
     - 全局概览 (Overview)
     - Pro P2P 直连与 3D 拓扑 (ProP2P)
     - 用户反馈中心 (Feedbacks)
     - 错误审计中心 (ErrorAudit)
     - 授权码与订单管控 (Licenses)
     - 黑名单管理 (Blacklist)
     - 系统健康监控 (SystemHealth)

4. **Native Inline 3D Globe Topology Validation (`ProP2P`)**:
   - Navigate to the **Pro P2P** tab.
   - Verify that `.globe-wrapper` renders the native WebGL/2D Canvas element directly without iframe dependencies.
   - Execute script check via `evaluate_script` to ensure:
     - `canvasPresent` is `true` (`.globe-wrapper canvas` exists and is active).
     - `#globe-status` or `.globe-card .badge` displays status (e.g. `WebGL 硬件加速` or 2D fallback mode).
     - Reactive connection dataset updates are rendered dynamically.

5. **Capture Verification Artifacts**:
   - Call `take_screenshot` via `chrome-devtools-mcp` to capture visual evidence of the rendered admin dashboard.
   - Verify layout responsiveness, card badges, and status elements.

---

## 4. Operational Checklist & Best Practices

- **Zero Security Compromise**: Never delete or weaken Cloudflare Access JWT validation or authorization checks in `functions/api/[[path]].ts` or `src/lib/api.ts`.
- **In-App Notifications**: Use non-blocking banners or in-app toasts for warnings; avoid browser `alert()` or `prompt()`.
- **Procedural Canvas Fallback**: Maintain procedural canvas fallback textures for `p2p-globe.html` so the 3D globe never turns black during external CDN outages.
- **DoD Enforcement**: A task is only complete when:
  1. Build succeeds locally (`npm run build`).
  2. Deployment is executed (`wrangler pages deploy`).
  3. Git changes are committed and pushed via `scripts/git-push-smart.sh`.
  4. Chrome MCP DevTools verification is confirmed.
