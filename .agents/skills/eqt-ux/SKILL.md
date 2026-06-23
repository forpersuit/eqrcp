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
- **Absolute Indicator Overlays**: Rather than placing inline status dots (like online indicator dots) directly inside the Flex layout flow (which wastes horizontal margin & padding space), wrap it inside the profile/logo wrapper and use absolute positioning with a panel-matching border (`border: 2px solid var(--panel)`) for a clean, overlapping badge appearance.
- **Prevent Action Overflows**:
  - Keep titles and badges strictly non-wrapping by applying `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`.
  - For narrow viewports (e.g. `<= 360px`), hide low-priority action buttons (such as `#share-session` session sharing button which is rarely used on visitor mobile devices) and scale down logos/gaps slightly to allocate sufficient space for the remaining actions.

