package e2ee

import (
	"errors"
	"fmt"
)

// ErrorCode represents a machine-readable, typed error identifier for E2EE operations.
type ErrorCode string

const (
	ErrCodeInvalidKeySize     ErrorCode = "INVALID_KEY_SIZE"
	ErrCodeCiphertextTooShort ErrorCode = "CIPHERTEXT_TOO_SHORT"
	ErrCodeChunkIndexMismatch ErrorCode = "CHUNK_INDEX_MISMATCH"
	ErrCodeAuthFailed         ErrorCode = "AUTH_FAILED"
	ErrCodeNonceGeneration    ErrorCode = "NONCE_GENERATION_FAILED"
	ErrCodeUninitialized      ErrorCode = "UNINITIALIZED"
	ErrCodeDeriveFailed       ErrorCode = "DERIVE_FAILED"
	ErrCodeCorruptedPayload   ErrorCode = "CORRUPTED_PAYLOAD"
	ErrCodeReplayDetected     ErrorCode = "REPLAY_DETECTED"
)

// Standard sentinel errors for backwards compatibility with errors.Is.
var (
	ErrInvalidKeySize     = &Error{Code: ErrCodeInvalidKeySize, Message: "master key must be exactly 32 bytes"}
	ErrCiphertextTooShort = &Error{Code: ErrCodeCiphertextTooShort, Message: "ciphertext too short"}
	ErrChunkIndexMismatch = &Error{Code: ErrCodeChunkIndexMismatch, Message: "chunk index mismatch"}
	ErrAuthFailed         = &Error{Code: ErrCodeAuthFailed, Message: "message authentication failed"}
	ErrUninitialized      = &Error{Code: ErrCodeUninitialized, Message: "crypto engine uninitialized"}
)

// Error is a structured, context-rich error for E2EE operations that maintains Zero-Telemetry privacy.
type Error struct {
	Code       ErrorCode `json:"code"`
	Op         string    `json:"op,omitempty"`
	ChunkIndex uint32    `json:"chunk_index,omitempty"`
	FileID     string    `json:"file_id,omitempty"`
	Seq        uint64    `json:"seq,omitempty"`
	Message    string    `json:"message"`
	Cause      error     `json:"-"`
}

// Error implements the standard error interface without leaking sensitive keys or plaintext.
func (e *Error) Error() string {
	if e == nil {
		return ""
	}

	var ctx string
	if e.FileID != "" && e.Op != "" {
		ctx = fmt.Sprintf(" [%s fileID=%s chunk=%d]", e.Op, e.FileID, e.ChunkIndex)
	} else if e.Op != "" {
		ctx = fmt.Sprintf(" [%s]", e.Op)
	}

	msg := e.Message
	if msg == "" && e.Code != "" {
		msg = string(e.Code)
	}

	if e.Cause != nil {
		return fmt.Sprintf("e2ee%s: %s: %v", ctx, msg, e.Cause)
	}
	return fmt.Sprintf("e2ee%s: %s", ctx, msg)
}

// Unwrap returns the underlying cause error.
func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// Is matches errors by ErrorCode or by sentinel error reference.
func (e *Error) Is(target error) bool {
	if e == nil || target == nil {
		return e == target
	}
	var t *Error
	if errors.As(target, &t) {
		return e.Code == t.Code
	}
	return false
}

// NewError creates a structured E2EE error.
func NewError(code ErrorCode, op string, message string) *Error {
	return &Error{
		Code:    code,
		Op:      op,
		Message: message,
	}
}

// WrapOpError wraps an existing error with operation context and error code.
func WrapOpError(code ErrorCode, op string, message string, cause error) *Error {
	return &Error{
		Code:    code,
		Op:      op,
		Message: message,
		Cause:   cause,
	}
}

// WrapChunkError creates a structured chunk error.
func WrapChunkError(code ErrorCode, op string, fileID string, chunkIndex uint32, message string, cause error) *Error {
	return &Error{
		Code:       code,
		Op:         op,
		FileID:     fileID,
		ChunkIndex: chunkIndex,
		Message:    message,
		Cause:      cause,
	}
}

// WrapPacketError creates a structured packet error.
func WrapPacketError(code ErrorCode, op string, seq uint64, message string, cause error) *Error {
	return &Error{
		Code:    code,
		Op:      op,
		Seq:     seq,
		Message: message,
		Cause:   cause,
	}
}
