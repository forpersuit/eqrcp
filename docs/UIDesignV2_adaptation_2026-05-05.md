# UI Design V2 Adaptation - 2026-05-05

First principle: EQT chat is not a social messenger. It is a transfer-first
workspace with a lightweight conversation layer. The UI should make the chat
thread dominant, keep session controls available but quiet, and treat files as
operable resources.

Reference inputs:

- `docs/UIDesignV2_describe.md`
- `docs/img/chatModeUI_V2.png`

## Direction

The V2 design changes hierarchy before it changes decoration:

- Chat flow is the primary workspace.
- Status is secondary and belongs in a compact control panel.
- Tools are available through settings, collapsible panels, or explicit
  resource actions.
- File, image, and video messages should read as resource blocks, not just text
  bubbles with attachments.

## Phase 1 Scope

Phase 1 is a structural and visual adaptation. It intentionally avoids deep
protocol work such as real upload progress and delivery receipts, but it now
includes lightweight chat presence because QR behavior depends on it.

Implemented scope:

- Make the Wails chat shell show `EQT Chat` with concise online/device context.
- Keep the shared browser chat page as the single message implementation.
- Style embedded chat messages as lighter blocks with device avatars.
- Make attachment/resource message actions visible by default.
- Keep text-message actions quiet until hover/focus.
- Move chat auto-save out of the main chat side panel and into Settings.
- Add a real `chatAutoSave` desktop setting, defaulting to enabled.
- Let the iframe notify the Wails shell about received attachments so the shell
  can auto-save them only when the setting is enabled.
- Track connected chat pages through SSE client tokens and expose the count to
  the desktop shell.
- Expand the chat QR automatically when a new chat starts, then collapse it
  after a second device joins.
- Keep Stop and Refresh in the Chat Status header; remove the repeated bottom
  Stop action, replace the repeated Refresh action with QR, and label the
  external open action as Browser.
- Restructure the Wails chat side panel into:
  - Chat Status
  - Collapsible Scan to Join Chat
  - Devices

## Auto-Save Placement

Auto-save is a chat-mode setting, not a real-time chat control. It belongs in
the gear Settings panel because it affects background behavior rather than the
current conversation flow.

Current behavior:

- `chatAutoSave` defaults to `true`.
- Received attachment messages in the Wails iframe emit an auto-save request to
  the desktop shell.
- The desktop shell saves attachments into the existing dated chat save
  directory only when `chatAutoSave` is enabled.
- Manual Save as remains available for attachments regardless of auto-save.

## Deliberate Phase 1 Limits

The V2 mock shows richer states than the current chat protocol exposes. These
are deferred:

- Named device list presence.
- Delivery/read receipts.
- Upload progress rows with sending/success/failed/cancelled states.
- Retry and cancel upload controls.
- Drag-out save support.
- Full right-click message menus.
- Local saved-path actions such as Open and Copy path for auto-saved files.

## Next Phases

Phase 2 should focus on resource actions:

- Add right-click menus inside the chat iframe.
- Extend the Wails bridge with Open, Copy path, and Save as actions.
- Track auto-saved attachment paths so file cards can expose local actions.

Phase 3 should focus on transfer state:

- Introduce client-visible attachment upload state.
- Show progress, bytes, retry, and cancellation.
- Add named device presence and delivery acknowledgements only after the state
  model can represent them accurately.
