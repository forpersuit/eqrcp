# Chat v2 Progress

Last updated: 2026-07-07

## Current Status

Chat v2 is in Phase 1: WebSocket Control Plane.

Phase 0 is complete. Phase 1 has started, but it is not yet user-facing. The
current `/chat-v2/{token}/ws` endpoint is a backend control-plane skeleton only:

- accepts WebSocket connections
- sends an initial `hello` event
- responds to `heartbeat` commands
- returns protocol `error` events for unsupported commands
- records connection, command, event, and disconnect diagnostics through `diag`

It does not yet create real chat sessions, track presence, send text messages,
serve a browser UI, or run `/chrome-test`.

## Commit Timeline

- `dc3c6dd` - Document chat v2 engineering plan
- `a260a37` - Add chat v2 protocol skeleton
- `f7474ec` - Add chat v2 diagnostics foundation
- `70706d7` - Add chat v2 websocket control skeleton

## Phase Checklist

### Phase 0: Skeleton and Contracts

Status: complete.

- [x] Create isolated `pkg/chat/v2/` package.
- [x] Keep legacy `/chat/{token}` independent from v2.
- [x] Define command/event/error protocol structs.
- [x] Add protocol JSON shape tests.
- [x] Add experimental HTTP handler skeleton.
- [x] Add `/chat-v2/{token}/health` skeleton route.
- [x] Add tests proving v2 handler does not catch legacy `/chat/...` routes.

Validation completed:

- `go test ./pkg/chat/v2/...`
- `go test ./...`
- pre-commit Windows artifact refresh through `scripts/deploy-windows-results.sh`

### Phase 1: WebSocket Control Plane

Status: in progress.

Completed:

- [x] Add `github.com/coder/websocket`.
- [x] Add `/chat-v2/{token}/ws` route to the experimental v2 handler.
- [x] Send initial `hello` event after connect.
- [x] Respond to `heartbeat` command.
- [x] Return protocol error for unsupported commands.
- [x] Add WebSocket integration tests with `httptest`.
- [x] Add diagnostic logs for connect, command receive, event send, and disconnect.

Remaining:

- [ ] Add `session.Manager` and per-token session lifecycle.
- [ ] Add client identity registration from `connect` command.
- [ ] Add presence tracking and `presence_changed` events.
- [ ] Add in-memory message store with monotonic event sequence.
- [ ] Implement `send_text` command.
- [ ] Broadcast `message_added` events to all connected clients in the same session.
- [ ] Add reconnect recovery using `joinSeq` and `afterSeq`.
- [ ] Add close handling that updates presence.
- [ ] Add minimal browser page or test harness required for `/chrome-test`.
- [ ] Run `/chrome-test` Scenario A once text exchange is user-visible.

Phase 1 exit criteria:

- two `/chat-v2/{token}` browser clients can exchange text through WebSocket
- reload/reconnect recovers missed messages without duplicates
- closing one client updates presence for the other client
- `go test ./pkg/chat/v2/...` and `go test ./...` pass
- `/chrome-test` Scenario A passes with screenshots or captured final states

### Phase 2: TransferManager

Status: not started.

Planned:

- [ ] Define transfer job model.
- [ ] Register native HTTP downloads as jobs.
- [ ] Measure server-side write progress.
- [ ] Publish transfer events over WebSocket.
- [ ] Keep browser downloads native; do not use XHR/fetch + Blob/ObjectURL.
- [ ] Validate download while chatting.

### Phase 3: Bandwidth Scheduler

Status: not started.

Planned:

- [ ] Implement data-plane token bucket or equivalent scheduler.
- [ ] Add per-device fairness.
- [ ] Ensure data transfers do not starve control messages.
- [ ] Add cancellation and fairness tests.

### Phase 4: Svelte Frontend

Status: not started.

Planned:

- [ ] Create Svelte + Vite app under `pkg/chat/v2/web`.
- [ ] Build message list, composer, attachment bubbles, transfer states, and device panel.
- [ ] Add WebSocket client service with reconnect and fallback handling.
- [ ] Validate responsive layout with `/chrome-test`.

### Phase 5: Desktop/Wails Integration

Status: not started.

Planned:

- [ ] Add experimental GUI switch for Chat v2.
- [ ] Preserve Wails native picker/save bridge.
- [ ] Keep v1 and v2 independently launchable.
- [ ] Refresh Windows acceptance artifacts.

## Current Capability Matrix

| Capability | Status | Notes |
| --- | --- | --- |
| v2 package isolation | Done | No legacy chat dependency on v2. |
| Protocol structs | Done | Commands, events, transfer states, errors. |
| JSON error response | Done | Via `diag.WriteError`. |
| Structured diagnostics | Done | `diag.Logger`, `StdLogger`, `MemoryLogger`. |
| HTTP skeleton | Done | `/chat-v2/{token}` returns not implemented; `/health` returns skeleton. |
| WebSocket accept | Done | `/chat-v2/{token}/ws`. |
| WebSocket hello | Done | Initial `hello` event. |
| WebSocket heartbeat | Done | `heartbeat` command returns `heartbeat` event. |
| Unsupported command error | Done | Returns protocol `error` event. |
| Session manager | Missing | Next step. |
| Presence | Missing | Requires session manager. |
| Text message exchange | Missing | Next functional milestone. |
| Reconnect recovery | Missing | Requires message store and seq tracking. |
| Browser UI | Missing | Needed before `/chrome-test`. |
| TransferManager | Missing | Phase 2. |
| Bandwidth scheduler | Missing | Phase 3. |
| Svelte frontend | Missing | Phase 4. |

## Test Record

Latest verified commands:

```sh
go test ./pkg/chat/v2/...
go test ./...
```

Latest pre-commit verification:

- Go full test suite
- Wails bindings generation
- GUI frontend build
- GUI Go tests
- Windows CLI/GUI artifact build
- acceptance artifacts written to `/mnt/e/developer/results`

`/chrome-test` status:

- Not run yet for v2.
- Reason: v2 currently has no browser-visible UI or text exchange flow.
- First required `/chrome-test`: Phase 1 Scenario A after WebSocket text exchange and minimal UI/test harness exist.

## Known Risks

- WebSocket currently uses `context.Background()` after accept because the
  request context is not reliable after hijacking. Future session shutdown must
  explicitly close active connections.
- The v2 handler is not mounted in production server setup yet. It is tested as
  an isolated handler.
- No browser UI exists yet, so mobile/Safari behavior is still unvalidated.
- Text messages are not implemented; current WebSocket tests are transport-level only.

## Next Step

Implement the Phase 1 session foundation:

1. Add `pkg/chat/v2/session`.
2. Create `Manager` keyed by chat token.
3. Add per-session client registry.
4. Add in-memory message store with monotonically increasing sequence.
5. Connect WebSocket `connect` command to client registration.
6. Emit `presence_changed` events.
7. Prepare `send_text` command implementation.

After that, implement text broadcast and then build the smallest browser-visible
test harness needed for `/chrome-test` Scenario A.
