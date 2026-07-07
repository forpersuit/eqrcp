# Chat v2

Chat v2 is a parallel implementation of EQT chat mode. It is intentionally
isolated from the legacy `pkg/server/chat.go` implementation until v2 passes
staged acceptance.

## Boundaries

- Legacy `/chat/{token}` behavior must not depend on this package.
- v2 should be mounted separately, for example under `/chat-v2/{token}`.
- Browser downloads must stay native HTTP downloads. Do not buffer regular
  downloads through browser XHR/fetch + Blob/ObjectURL.
- WebSocket is the control plane for messages, presence, and transfer events.
- HTTP streams are the data plane for file bytes.

## Phase 0 Scope

This package currently contains only skeleton contracts:

- protocol command and event envelopes
- typed event payloads for messages, presence, transfer state, and errors
- an unmounted experimental HTTP handler for future `/chat-v2/{token}` routes

It does not create chat sessions, serve the Svelte frontend, or handle file
transfers yet.

## Validation

Each v2 phase must preserve legacy chat behavior and pass:

```sh
go test ./pkg/chat/v2/...
go test ./...
```

When a phase changes browser-visible behavior, it must also include
`/chrome-test` evidence as described in `docs/chat-v2-engineering-plan.md`.
