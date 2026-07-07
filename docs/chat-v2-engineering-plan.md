# Chat v2 Engineering Plan

## Goal

Chat v2 is a parallel rewrite of chat mode. It must not modify or regress the
existing `/chat/{token}` implementation until v2 has passed staged acceptance.

The target architecture is:

- TransferManager for uploads, downloads, progress, cancellation, and job state.
- WebSocket event bus for chat control events and transfer state events.
- Bandwidth scheduler for fair data transfer without starving chat control.
- Svelte + Vite frontend for a maintainable chat UI.
- Native browser HTTP downloads for mobile browser stability; no browser
  XHR/fetch + Blob/ObjectURL download path.

## Directory Layout

Use `pkg/chat/v2/` instead of a repository-level `v2/` directory.

```text
pkg/chat/v2/
  README.md
  protocol/
    commands.go
    events.go
    errors.go
  session/
    manager.go
    session.go
    client.go
    message_store.go
  eventbus/
    bus.go
    subscriber.go
  transport/
    websocket.go
    fallback_sse.go
  transfer/
    manager.go
    job.go
    download.go
    upload.go
    progress.go
  bandwidth/
    scheduler.go
    limiter.go
    policy.go
  http/
    routes.go
    files.go
    health.go
  web/
    package.json
    vite.config.ts
    src/
      App.svelte
      components/
      services/
      state/
```

The legacy `pkg/server/chat.go` stays in place. v2 should be mounted under an
experimental route such as `/chat-v2/{token}` until the final cutover.

## Architecture Boundaries

### Control Plane

Use WebSocket for low-volume, high-priority state:

- client connect, reconnect, and heartbeat
- presence and device roster
- text message commands
- message events
- transfer job state and progress events
- server notices and errors

The control plane must remain usable while one or more file downloads are active.

### Data Plane

Use HTTP streams for file bytes:

- browser downloads use native `<a href download>`
- server-side progress is measured while writing the HTTP response
- uploads use streaming or resumable upload mechanics
- no browser-side large Blob buffering for regular downloads

### Scheduler

The scheduler owns data-plane fairness:

- control-plane traffic has priority and should not be throttled by file jobs
- each active device receives a bounded share of data bandwidth
- large downloads cannot starve small uploads, text messages, or status events
- free/paid policies affect data-plane rate and concurrency, not basic control-plane availability

## Implementation Phases

### Phase 0: Skeleton and Contracts

Deliverables:

- `pkg/chat/v2/README.md`
- protocol command/event structs
- empty route registration behind an experimental flag or route
- initial unit tests for protocol JSON compatibility

DoD:

- existing `/chat/{token}` behavior unchanged
- `go test ./...` passes
- no Wails or Windows artifact change required unless a build hook requires it

### Phase 1: WebSocket Control Plane

Deliverables:

- WebSocket endpoint using `github.com/coder/websocket`
- connect, heartbeat, reconnect, and close handling
- send text through WebSocket
- event sequence and missed-event recovery
- SSE/fetch fallback retained for browsers where WebSocket fails

DoD:

- two browser clients can exchange text through `/chat-v2/{token}`
- reconnect does not duplicate or lose messages
- closing one client updates presence for the other client
- `go test ./pkg/chat/v2/...` and `go test ./...` pass
- `/chrome-test` validates two Chrome tabs exchanging messages and reconnecting

### Phase 2: TransferManager

Deliverables:

- transfer job model with queued, running, completed, failed, and cancelled states
- native HTTP download registration with server-side progress writer
- transfer progress events sent over WebSocket
- upload job registration and completion events

DoD:

- browser downloads do not use XHR/fetch + Blob/ObjectURL
- a large native download keeps the WebSocket text channel responsive
- progress is visible from server-side write progress
- failed/cancelled transfers produce in-app system notices, not browser alerts
- `/chrome-test` validates downloading while sending messages

### Phase 3: Bandwidth Scheduler

Deliverables:

- token-bucket or equivalent scheduler
- per-device fairness
- per-job state updates
- policy hooks for free/paid throttling

DoD:

- two concurrent downloads do not block text messages
- one large transfer does not starve a second device
- throttling changes data-plane speed, not chat control availability
- unit tests cover scheduler fairness and cancellation
- `/chrome-test` validates concurrent downloads plus live text send

### Phase 4: Svelte Frontend

Deliverables:

- Svelte + Vite app under `pkg/chat/v2/web`
- message list, composer, attachment bubble, transfer state, device panel
- WebSocket client service with reconnect and fallback
- responsive mobile and embedded Wails layouts

DoD:

- visual behavior matches or improves legacy chat
- no overlapping text or controls at mobile and desktop widths
- scroll behavior remains stable during transfer progress
- no visible alert/confirm/prompt usage for normal errors
- `/chrome-test` captures completed desktop and mobile states

### Phase 5: Desktop/Wails Integration

Deliverables:

- experimental GUI switch for Chat v2
- iframe or embedded route updated to load v2 only when enabled
- Wails native file picker/save bridge support preserved

DoD:

- v1 and v2 can be launched independently
- v2 can be disabled without affecting v1
- `scripts/deploy-windows-results.sh` passes and refreshes acceptance artifacts

## Required Test Matrix

Every functional v2 phase must include deterministic tests at these layers:

- Go unit tests for protocol, event bus, session, transfer, scheduler.
- HTTP handler tests for routes, downloads, range behavior, and errors.
- WebSocket integration tests using in-process HTTP servers.
- Frontend build tests once Svelte is introduced.
- `/chrome-test` browser simulation for user-facing chat flows.
- Windows acceptance deployment for GUI-facing or desktop-facing changes.

## `/chrome-test` Acceptance Scenarios

The v2 Chrome MCP simulation should grow in stages.

### Scenario A: Text Control Plane

1. Start local v2 chat server on a fixed port, for example `18082`.
2. Open two Chrome tabs to `/chat-v2/<token>`.
3. Send text from tab A and verify it appears in tab B.
4. Send text from tab B and verify it appears in tab A.
5. Reload tab B and verify missed messages are recovered without duplicates.
6. Capture screenshots of both final message lists.

### Scenario B: Download While Chatting

1. Start a v2 session with two downloadable files.
2. Start a native browser download for file 1.
3. While file 1 is active, send text from the same tab.
4. Verify the text appears on the other tab before the download finishes.
5. Start file 2 and verify transfer states update without page crash.
6. Capture screenshots showing active transfer state and delivered text.

### Scenario C: Bandwidth Fairness

1. Start two clients.
2. Start concurrent downloads from both clients.
3. Send text from both clients during active downloads.
4. Verify control messages are delivered under load.
5. Verify both transfer jobs make progress over time.

### Scenario D: Mobile Layout

Use Chrome mobile viewport emulation:

1. Verify composer remains usable during active transfers.
2. Verify transfer indicators do not overlap message text.
3. Verify device and session controls fit narrow widths.

## Non-Negotiable Regression Rules

- Do not route regular browser downloads through Blob/ObjectURL.
- Do not remove the existing chat implementation until v2 is the default and has passed acceptance.
- Do not introduce browser alert/confirm/prompt for chat warnings or transfer errors.
- Do not merge a phase without its `/chrome-test` evidence when UI behavior is touched.
- Do not treat a passing unit test as enough for browser or mobile behavior.

## Cutover Criteria

Chat v2 can replace legacy chat only after:

- v2 passes all staged DoD items.
- Chrome MCP simulation covers text, reconnect, downloads, transfer progress, and responsive layouts.
- Windows artifacts have been refreshed through `scripts/deploy-windows-results.sh`.
- v1 remains available behind a fallback switch for at least one release.
