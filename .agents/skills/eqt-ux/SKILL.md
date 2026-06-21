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
- **Issue**: Full DOM overwriting (using `innerHTML` replacements) causes temporary form changes and button loading states to be destroyed.
- **Rule**:
  - Keep volatile state (such as update checking/downloading stages, warning messages, buttons content, etc.) synchronized in the global `state` store rather than keeping them purely inside the DOM.
  - Dynamically read from the global `state` when constructing panels (e.g. `renderSettingsPanel()`).
  - Wire change/input event listeners on settings controls to eagerly write back latest DOM values to memory (e.g. via `syncSettingsFromDOM()`). This prevents user configuration changes from being wiped out by a sudden global page redraw before clicking "Save".
