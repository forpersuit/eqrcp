# Chat Mode Development Progress

First principle: chat mode is a local session, not a one-time transfer. The QR
code should grant access to one short-lived LAN conversation where desktop and
mobile browsers can exchange text and attachments until the user ends it.

## Scope

Initial scope:

- Add `eqrcp chat`.
- Open a browser chat surface with `--browser`.
- Let a scanned mobile browser join the same session.
- Support text messages.
- Support file and image attachments as downloadable chat messages.
- Keep the session alive until the user stops it.

Out of scope for the first pass:

- Persistent chat history.
- End-to-end encryption beyond the existing local HTTP/HTTPS configuration.
- Multi-room management.
- Native Wails chat UI.
- Desktop agent `chat` task integration.

## Implementation Phases

### Phase 1: Browser MVP

Status: browser MVP implemented.

- [x] Add server-side chat session model.
- [x] Add chat routes under `/chat/{path}`.
- [x] Add SSE event stream for new messages.
- [x] Add POST route for text messages.
- [x] Add multipart upload route for attachments.
- [x] Add embedded chat page template.
- [x] Add `eqrcp chat` command.
- [x] Add focused server tests.

Acceptance criteria:

- Running `eqrcp chat --browser` opens the desktop chat page.
- The terminal prints a QR URL for mobile devices.
- Desktop and mobile browsers see the same message history.
- Sending text from either browser appears on the other side without refresh.
- Uploading a file or image creates a chat message with a download link.
- Stopping the CLI shuts down the session.

### Phase 2: Desktop Agent Integration

Status: planned.

- Add `chat` as a desktop agent task action.
- Track chat task lifecycle separately from send/receive transfer completion.
- Add stop/current/open-current support for active chat sessions.
- Add agent history entry for ended chat sessions.

Acceptance criteria:

- `eqrcp desktop chat` starts through the agent.
- Agent status shows active chat session URL.
- Existing share/receive tasks remain unchanged.

### Phase 3: Wails GUI Chat Surface

Status: planned.

- Add a `Chat` mode to the GUI.
- Render active chat session in the app.
- Send text and attachments from the GUI.
- Subscribe to chat events from the GUI.
- Show mobile QR inside the GUI.

Acceptance criteria:

- The desktop app can create and use a chat session without relying on the
  browser page for desktop-side messaging.
- Mobile browser and desktop GUI stay synchronized.

## Design Notes

- Use SSE plus HTTP POST for the MVP. The project already uses `EventSource`,
  and POST routes are enough for reliable bidirectional messaging.
- Store attachments as files, not base64 JSON payloads.
- Treat the random URL path as the access token.
- Default to temporary attachment storage for privacy and cleanup.
- Keep chat session state independent from `transferStatus`; agent integration
  can wrap it later as a task record.

## Risks

- Chat sessions are long-lived, while existing transfer tasks usually terminate
  after completion.
- The desktop agent's busy/current/history model needs explicit chat semantics.
- Browser upload limits and temporary storage cleanup need careful tests.
- Mobile browser support should be validated manually on iOS Safari and Android
  Chrome before release.
