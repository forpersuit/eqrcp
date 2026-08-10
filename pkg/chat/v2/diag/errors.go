package diag

import (
	"errors"
	"fmt"
	"net/http"

	"eqt/pkg/chat/v2/protocol"
)

// Error carries a protocol-facing error code, HTTP status, and internal cause.
type Error struct {
	Code    protocol.ErrorCode
	Message string
	Status  int
	Cause   error
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.Cause == nil {
		return e.Message
	}
	return fmt.Sprintf("%s: %v", e.Message, e.Cause)
}

func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// NewError creates a v2 diagnostic error.
func NewError(code protocol.ErrorCode, status int, message string) *Error {
	return &Error{Code: code, Status: status, Message: message}
}

// WrapError creates a v2 diagnostic error with an internal cause.
func WrapError(code protocol.ErrorCode, status int, message string, cause error) *Error {
	return &Error{Code: code, Status: status, Message: message, Cause: cause}
}

// NormalizeError converts arbitrary errors to diagnostic errors.
func NormalizeError(err error) *Error {
	if err == nil {
		return NewError(protocol.ErrorInternal, http.StatusInternalServerError, "internal error")
	}
	var diagErr *Error
	if errors.As(err, &diagErr) {
		if diagErr.Status == 0 {
			diagErr.Status = http.StatusInternalServerError
		}
		if diagErr.Code == "" {
			diagErr.Code = protocol.ErrorInternal
		}
		return diagErr
	}
	return WrapError(protocol.ErrorInternal, http.StatusInternalServerError, "internal error", err)
}

// Payload returns the public protocol error payload.
func (e *Error) Payload() protocol.ErrorPayload {
	if e == nil {
		return protocol.ErrorPayload{}
	}
	return protocol.ErrorPayload{
		Code:    e.Code,
		Message: e.Message,
	}
}
