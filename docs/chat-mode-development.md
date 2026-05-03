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

Status: **completed**.

- [x] Add `chat` as a desktop agent task action.
- [x] Track chat task lifecycle separately from send/receive transfer completion.
- [x] Add stop/current/open-current support for active chat sessions.
- [x] Add agent history entry for ended chat sessions.
- [x] Add chat status tracking with message count and session state.
- [x] Display chat session details in agent status page.
- [x] Support repeat for chat history items.

Acceptance criteria:

- [x] `eqrcp desktop chat` starts through the agent.
- [x] Agent status shows active chat session URL and message count.
- [x] Existing share/receive tasks remain unchanged.
- [x] Chat sessions properly finalize when stopped.
- [x] History shows meaningful chat session details.

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

## Desktop Agent Integration

Status: **Phase 2 completed**.

### Implementation Summary

Chat sessions are now fully integrated with the desktop agent:

1. **Chat Status Tracking**
   - Added `ChatStatusSnapshot` with state, message count, and activity tracking
   - Chat sessions report "waiting", "active", and "ended" states
   - Status updates trigger on first message and every 10 messages

2. **Desktop Agent Support**
   - `desktopAgentTaskRecord` includes chat-specific fields:
     - `ChatState`: current session state
     - `ChatMessageCount`: number of messages exchanged
     - `ChatLastActivity`: timestamp of last activity
   - `observeChatStatus` method tracks chat session lifecycle
   - Chat tasks move to history when session ends

3. **Status Display**
   - Agent status page shows chat session details
   - Command-line `agent-status` displays message count and state
   - History records preserve chat session information

4. **Task Lifecycle**
   - `eqrcp desktop chat` starts chat via agent
   - Stop current works for active chat sessions
   - Repeat works for chat history items
   - Chat sessions properly finalize on stop

### Usage

```bash
# Start desktop agent
eqrcp desktop agent-start -B

# Start chat session (via agent)
eqrcp desktop chat

# Check agent status
eqrcp desktop agent-status

# Open agent status page
eqrcp desktop agent-open

# Stop current chat
eqrcp desktop agent-stop-current
```

### Testing

All tests pass:
- `TestDesktopAgentObservesChatStatus`: Verifies chat status tracking
- `TestDesktopAgentChatEndedMovesToHistory`: Verifies lifecycle management
- `TestValidateDesktopAgentChatTask`: Verifies task validation

## Mobile Connection Stability Enhancement

Status: **Phase 1 completed**.

### Problem Identified

Mobile browsers (iOS Safari, Android Chrome) suspend background tabs and close
SSE connections when users switch apps. The current implementation does not
detect or recover from these disconnections, causing message sync failures.

### Solution Plan

Implementing Page Visibility API + intelligent reconnection (Phase 1):

- [x] Problem analysis and solution design completed
- [x] Client-side reconnection logic with Page Visibility API
- [x] Server-side Last-Event-ID support for message recovery
- [x] Connection health check endpoint
- [x] Exponential backoff for reconnection attempts
- [x] Visual connection status indicators
- [x] Unit tests for new functionality
- [ ] Mobile device testing (iOS Safari, Android Chrome)

Future enhancement (Phase 2):

- [ ] Polling fallback for unstable networks
- [ ] WebSocket migration consideration

### Implementation Details

Client improvements:

- Detect page visibility changes using Page Visibility API
- Reconnect SSE only when page becomes visible
- Use Last-Event-ID to recover missed messages
- Verify connection health on visibility change
- Exponential backoff with max delay cap (1s → 30s)
- Automatic fallback to polling if EventSource unavailable

Server improvements:

- Support Last-Event-ID header and query parameter
- Filter messages after specified ID for recovery
- Add /health endpoint for connection verification
- Include message ID in SSE event stream

### Testing Strategy

Automated tests:
- ✅ `TestFilterMessagesAfter` - Message recovery logic
- ✅ `TestChatHealthEndpoint` - Health check endpoint
- ✅ `TestChatLastEventIDRecovery` - Last-Event-ID support
- ✅ `TestChatPageIncludesMessagingRoutes` - Client-side reconnection code

Manual testing required:
- [ ] Background/foreground switching (1 min, 5 min, 10 min)
- [ ] Network switching (WiFi ↔ 4G)
- [ ] Low power mode behavior
- [ ] Multi-device synchronization
- [ ] Connection recovery verification

### Testing Instructions

1. Start chat session:
   ```bash
   eqrcp chat --browser
   ```

2. Open mobile browser and scan QR code

3. Test scenarios:
   - Send messages from both devices
   - Switch mobile browser to background for 1 minute
   - Switch back and verify messages sync
   - Repeat with 5 minute and 10 minute delays
   - Test with network interruption
   - Test with multiple devices simultaneously

4. Monitor connection status in browser console:
   - Check for "Reconnecting..." messages
   - Verify "Connected as [name]" after reconnection
   - Confirm no message loss

### Known Limitations

- SSE connections may take up to 30 seconds to detect stale connections
- Very long background periods (>10 minutes) may require manual refresh
- Browser-specific behavior may vary (iOS Safari vs Android Chrome)

## Risks

- Chat sessions are long-lived, while existing transfer tasks usually terminate
  after completion.
- The desktop agent's busy/current/history model needs explicit chat semantics.
- Browser upload limits and temporary storage cleanup need careful tests.
- Mobile browser support should be validated manually on iOS Safari and Android
  Chrome before release.
