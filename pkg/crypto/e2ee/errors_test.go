package e2ee

import (
	"errors"
	"strings"
	"testing"
)

func TestStructuredErrors(t *testing.T) {
	// 1. Sentinel match
	rootErr := errors.New("underlying cipher error")
	chunkErr := WrapChunkError(ErrCodeAuthFailed, "DecryptChunk", "file-123", 5, "auth verification failed", rootErr)

	if !errors.Is(chunkErr, ErrAuthFailed) {
		t.Fatalf("expected errors.Is(chunkErr, ErrAuthFailed) to be true")
	}

	if !errors.Is(chunkErr, &Error{Code: ErrCodeAuthFailed}) {
		t.Fatalf("expected errors.Is to match by ErrorCode")
	}

	if errors.Is(chunkErr, ErrChunkIndexMismatch) {
		t.Fatalf("expected errors.Is(chunkErr, ErrChunkIndexMismatch) to be false")
	}

	// 2. Unwrap
	if !errors.Is(chunkErr, rootErr) {
		t.Fatalf("expected errors.Is to unwrap rootErr")
	}

	// 3. Error string format
	errStr := chunkErr.Error()
	if !strings.Contains(errStr, "fileID=file-123") || !strings.Contains(errStr, "chunk=5") {
		t.Fatalf("expected error string to contain context, got: %s", errStr)
	}

	// 4. Packet Error
	pktErr := WrapPacketError(ErrCodeReplayDetected, "DecryptPacket", 1005, "sequence replay intercepted", nil)
	if !errors.Is(pktErr, &Error{Code: ErrCodeReplayDetected}) {
		t.Fatalf("expected errors.Is(pktErr, ErrCodeReplayDetected) to be true")
	}
}
