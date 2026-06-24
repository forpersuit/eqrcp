---
name: eqt-ux
description: Guidelines for EQT user interface, notification styles, and UX rules, emphasizing in-app system messages over blocking alert dialogs.
---

# EQT UI & Notification Guidelines

## No Alert-style Interruptions
- Avoid using browser-level `alert()`, `confirm()`, or `prompt()` dialogs for regular user notifications, warnings, or errors.
- Always prefer non-intrusive, in-app messaging patterns:
  - For chat-related issues (e.g., file size limit exceeded, network warning), append a system notification message directly into the chat message list using the `showSystemNotice(msg)` helper.
  - For configuration or non-critical state warnings, use in-app toast overlays or non-blocking banners.
- Only use standard dialog elements (like error click/touch callbacks on badge status) when explicitly designed for user-interactive diagnostic lookups.

## Handling Volatile UI State During Full Rerender
- **Issue**: Full DOM overwriting (using `innerHTML` replacements) causes temporary form changes, button loading states, scroll positions, and focus states to be destroyed.
- **Rule**:
  - Keep volatile state (such as update checking/downloading stages, warning messages, buttons content, etc.) synchronized in the global `state` store rather than keeping them purely inside the DOM.
  - Dynamically read from the global `state` when constructing panels (e.g. `renderSettingsPanel()`).
  - Wire change/input event listeners on settings controls to eagerly write back latest DOM values to memory (e.g. via `syncSettingsFromDOM()`). This prevents user configuration changes from being wiped out by a sudden global page redraw before clicking "Save".
  - **In-place Node Updates**: For high-frequency or local state changes (e.g. update check statuses, buttons), prefer updating target DOM elements directly in-place (e.g. via `textContent` or `disabled` status) instead of calling a full re-render or overlay recreation (`syncPanelSurface`). This avoids layout-timing scroll jumps (which clamp `scrollTop` to 0 because of unfinished layout passes when DOM is replaced) and preserves focus.
  - **Fallback Scroll Restoration**: When replacing the overlay/modal is unavoidable, restore `scrollTop` immediately and also in subsequent ticks (e.g. `setTimeout(..., 0)` and `setTimeout(..., 50)`) to ensure the browser has completed its layout calculation and will not clamp `scrollTop` back to 0.

## Mobile Layout Adaptations & Titlebar Constraints
- **Branding & License Badges**: Add high-contrast license tier badges (e.g. using `.license-badge` with `var(--accent)`) next to the brand logo or title text. On mobile views, place it next to EQT title. On desktop GUI views, place it to the left of the 'Chat Status' sidebar panel header, scaling it down slightly (`font-size: 9px;`) to match the smaller layout context. Hide irrelevant timer status capsules (`.limit-status-pill`) when a paid plan is active, showing only the badge.
- **Prevent Action Overflows**:
  - Keep titles and badges strictly non-wrapping by applying `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`.
  - For narrow viewports (e.g. `<= 360px`), hide low-priority action buttons (such as `#share-session` session sharing button which is rarely used on visitor mobile devices) and scale down logos/gaps slightly to allocate sufficient space for the remaining actions.
- **Modals & Collapsible Panels Layout**:
  - Ensure mobile responsive modals/panels (such as `.session-backdrop.open .side`) preserve grid structures: do not rawly override `display` to `block` in media queries as it clears `grid-gap` spacing and compresses buttons; maintain `display: grid` with appropriate gaps (e.g. `gap: 14px`) to preserve spacing.

## Real-time Viewport & Setting Sync (Viewport Debug Toggling)
- **Problem**: When settings like "Enable Viewport Debug Box" are toggled in the desktop GUI Settings, mobile clients currently connected need to sync this state dynamically without requiring a manual page reload.
- **Solution**:
  - Expose the dynamic configurations on the Go server `/health` route (e.g. `"viewportDebug": s.ViewportDebug`).
  - In client-side JS (`updateChatStatus(data)`), detect the change dynamically by comparing `enabled !== viewportDebugEnabled`.
  - When state changes, manipulate DOM class attributes directly (add/remove `.open`, `aria-hidden`), update layout constraints inline, and fire viewport metric adjustments (e.g., `handleViewportChange()`) without forcing a full client page refresh.

## Multi-language (i18n) & Locale Matching
- **Desktop UI (Wails)**:
  - 界面语言首选项（例如 Settings 页面下的 `Lang` 字段）在后台 `config/settings.go` 中持久化并同步给前端。
  - 使用 `translations[lang][key]` 进行界面词条替换。在保存并更新语言选项时，应通过 `updatePageTranslations()` 及时动态局部更新 DOM 以支持无缝的语种热切换。
- **Mobile Pages (`upload.tmpl.html` & `chat.tmpl.html`)**:
  - 默认根据打开网页的浏览器语言首选项 `navigator.language` 来动态渲染对应的语种。
  - 扫码接入的 receive 模式（`upload.tmpl.html`）应在右下角悬浮显示可进行语种切换的下拉框 `<select>`，允许用户切换时在 LocalStorage 中持久化 `eqt-page-lang` 偏好。
  - 为了稳妥应对翻译缺漏或新增词条，对其它不支持的次要语言，在字典初始化时必须先与 `i18n.en` 英文词条进行深度 Merge，作为安全回退兜底，防止出现 JS 未定义键的空指针报错。



