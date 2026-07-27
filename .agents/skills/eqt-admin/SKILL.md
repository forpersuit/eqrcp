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

### Step 2: Cloudflare Pages Manual Deployment
Deploy the compiled static bundle (`dist/`) and Workers Functions (`functions/`) directly to Cloudflare Pages.

#### Method A: Run directly inside `cloudflare/eqt-admin` root directory (Recommended):
```sh
cd cloudflare/eqt-admin
npm run build
npx wrangler pages deploy dist --project-name eqt-admin
```

#### Method B: Run from repository root:
```sh
npm --prefix cloudflare/eqt-admin run build
npx wrangler pages deploy cloudflare/eqt-admin/dist --project-name eqt-admin
```

If Cloudflare Access environment parameters or API tokens are required:
```sh
VITE_ADMIN_AUTH_MODE=access \
VITE_CF_ACCESS_TEAM_DOMAIN=persuit.cloudflareaccess.com \
npx wrangler pages deploy cloudflare/eqt-admin/dist --project-name eqt-admin
```

### Step 3: Git Cleanliness & Smart Push
Ensure working directory is clean, stage modifications, commit with concise imperative messages, and push via WSL smart proxy script:

```sh
git add cloudflare/eqt-admin/
git commit -m "Update admin feature X and fix Y"
scripts/git-push-smart.sh
```

---

## 3. Chrome DevTools MCP E2E Verification Workflow

After every non-trivial update or deployment to the Admin system, perform an automated E2E simulation using `chrome-devtools-mcp` tools.

### E2E Test Execution Steps:

1. **Target Selection**:
   - **Local Dev Simulation**: Ensure dev server is running (`npm --prefix cloudflare/eqt-admin run dev` on `http://localhost:3001`).
   - **Production Simulation**: Target `https://admin.eqt.net.im`.

2. **Navigate & Page Selection**:
   - Use `chrome-devtools-mcp`'s `list_pages` or `new_page` / `navigate_page` to open the Admin target URL.
   - Example: Navigate to `http://localhost:3001` or `https://admin.eqt.net.im`.

3. **Verify Tab Navigation & Page Render**:
   - Click/evaluate navigation buttons (`.nav-item`) to verify each tab loads cleanly without unhandled JavaScript exceptions:
     - 全局概览 (Overview)
     - Pro P2P 直连与 3D 拓扑 (ProP2P)
     - 用户反馈中心 (Feedbacks)
     - 错误审计中心 (ErrorAudit)
     - 授权码与订单管控 (Licenses)
     - 黑名单管理 (Blacklist)
     - 系统健康监控 (SystemHealth)

4. **3D Globe Topology Screen Validation (`ProP2P`)**:
   - Navigate to the **Pro P2P** tab.
   - Verify that the embedded `<iframe src="/p2p-globe.html">` renders correctly.
   - Execute script check via `evaluate_script` to ensure:
     - WebGL / 2D Canvas is actively rendering (`#canvas-container canvas` exists).
     - `#globe-status` text displays status (e.g. `3D 实时拓扑与全球节点流动大屏 (WebGL 加速)` or 2D fallback mode).
     - `postMessage` data synchronization is receiving connection datasets.

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
