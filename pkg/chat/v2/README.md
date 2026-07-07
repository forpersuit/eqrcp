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
- diagnostic errors, JSON error responses, and structured logger hooks
- an unmounted experimental HTTP handler for future `/chat-v2/{token}` routes
- an early WebSocket control-plane endpoint that emits `hello`, responds to
  `heartbeat`, and reports unsupported commands as protocol errors

It does not create chat sessions, serve the Svelte frontend, or handle file
transfers yet.

## Development Infrastructure

The `diag` package is the v2 observability foundation:

- `diag.Error` maps internal failures to public protocol error codes and HTTP
  status codes.
- `diag.WriteError` returns JSON errors that future frontend and WebSocket
  code can handle consistently.
- `diag.Logger` records structured events with stable fields such as method,
  path, token, command ID, client ID, transfer ID, and error.
- `diag.MemoryLogger` lets tests assert operational events without parsing text
  logs.

WebSocket, event bus, TransferManager, and bandwidth scheduler code should use
these hooks from the start instead of temporary prints.

## Validation

Each v2 phase must preserve legacy chat behavior and pass:

```sh
go test ./pkg/chat/v2/...
go test ./...
```

When a phase changes browser-visible behavior, it must also include
`/chrome-test` evidence as described in `docs/chat-v2-engineering-plan.md`.
