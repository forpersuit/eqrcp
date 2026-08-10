package protocol

// ErrorCode identifies a recoverable protocol or session error.
type ErrorCode string

const (
	ErrorBadCommand       ErrorCode = "bad_command"
	ErrorUnauthorized     ErrorCode = "unauthorized"
	ErrorSessionClosed    ErrorCode = "session_closed"
	ErrorTransferNotFound ErrorCode = "transfer_not_found"
	ErrorInternal         ErrorCode = "internal"
)

// ErrorPayload is sent in EventError events.
type ErrorPayload struct {
	Code    ErrorCode `json:"code"`
	Message string    `json:"message"`
}
