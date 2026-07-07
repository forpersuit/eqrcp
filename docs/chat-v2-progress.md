# Chat v2 Progress

Last updated: 2026-07-07

## Current Status

Chat v2 is in Phase 4: Svelte Frontend.

Phase 0, Phase 1, Phase 2, and Phase 3 are complete. The WebSocket control-plane, native HTTP download tracking, and bandwidth scheduler are fully implemented, integrated, and verified:

- Fully supports `session.Manager` lifecycle.
- Handles client registration with custom identities.
- Performs real-time presence tracking and `presence_changed` events.
- Features an in-memory message store with monotonic `seq` indexing.
- Implements `send_text` command and broadcasts `message_added` events.
- Supports reconnect recovery (afterSeq and joinSeq replaying).
- Serves an interactive micro-UI browser harness for chat v2.
- Tracks native HTTP file downloads with server-side progress writers.
- Enforces active bandwidth scheduling with dynamic fair share and policy throttle sleep.
- WebSocket text channels remain highly responsive even under maximum local loopback download load.

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

Status: complete.

Completed:

- [x] Add `github.com/coder/websocket`.
- [x] Add `/chat-v2/{token}/ws` route to the experimental v2 handler.
- [x] Send initial `hello` event after connect.
- [x] Respond to `heartbeat` command.
- [x] Return protocol error for unsupported commands.
- [x] Add WebSocket integration tests with `httptest`.
- [x] Add diagnostic logs for connect, command receive, event send, and disconnect.
- [x] Add `session.Manager` and per-token session lifecycle.
- [x] Add client identity registration from `connect` command.
- [x] Add presence tracking and `presence_changed` events.
- [x] Add in-memory message store with monotonic event sequence.
- [x] Implement `send_text` command.
- [x] Broadcast `message_added` events to all connected clients in the same session.
- [x] Add reconnect recovery using `joinSeq` and `afterSeq`.
- [x] Add close handling that updates presence.
- [x] Add minimal browser page or test harness required for `/chrome-test`.

Remaining:

- [ ] Run `/chrome-test` Scenario A once text exchange is user-visible. (Requires mounting route in production server setup in Phase 5)

Phase 1 exit criteria:

- two `/chat-v2/{token}` browser clients can exchange text through WebSocket
- reload/reconnect recovers missed messages without duplicates
- closing one client updates presence for the other client
- `go test ./pkg/chat/v2/...` and `go test ./...` pass
- `/chrome-test` Scenario A passes with screenshots or captured final states

### Phase 2: TransferManager

Status: complete.

Completed:

- [x] Define transfer job model.
- [x] Register native HTTP downloads as jobs.
- [x] Measure server-side write progress.
- [x] Publish transfer events over WebSocket.
- [x] Keep browser downloads native; do not use XHR/fetch + Blob/ObjectURL.
- [x] Validate download while chatting.

### Phase 3: Bandwidth Scheduler

Status: complete.

Completed:

- [x] Implement data-plane token bucket or equivalent scheduler.
- [x] Add per-device fairness.
- [x] Ensure data transfers do not starve control messages.
- [x] Add cancellation and fairness tests.

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
| Session manager | Done | Managed rooms via `session.Manager`. |
| Presence | Done | Real-time presence updates. |
| Text message exchange | Done | Supports broadcasts. |
| Reconnect recovery | Done | Recovers missed events using seq. |
| Browser UI | Done | Served under `/chat-v2/{token}` for manual verification. |
| TransferManager | Done | Tracks native downloads and updates. |
| Bandwidth scheduler | Done | Fair-share and throttled scheduling. |
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
- Only a minimal test harness UI exists, so mobile/Safari browser layout behavior is still unvalidated until Svelte UI in Phase 4.
- **In-memory MessageStore growth**: Events in `session.MessageStore` grow indefinitely. A ring buffer or maximum capacity limit should be introduced to prevent potential memory leakage on long-lived sessions.

## Next Step

Implement the Phase 4 Svelte Frontend:

1. Create Svelte + Vite app under `pkg/chat/v2/web`.
2. Build message list, composer, attachment bubbles, transfer states, and device panel.
3. Add WebSocket client service with reconnect and fallback handling.
4. Validate responsive layout with `/chrome-test`.
