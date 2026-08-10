package util

import (
	"regexp"
	"strings"
	"testing"
)

// uuidV4Pattern matches standard UUID v4 format: 8-4-4-4-12 hex digits.
var uuidV4Pattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestTraceID(t *testing.T) {
	// Reset for test isolation — use a fresh variable to avoid polluting
	// the process-wide singleton for other tests.
	// We test the exported function contract, not the internal state.

	t.Run("returns non-empty string", func(t *testing.T) {
		id := TraceID()
		if id == "" {
			t.Fatal("TraceID() returned empty string")
		}
	})

	t.Run("matches UUID v4 format", func(t *testing.T) {
		id := TraceID()
		if !uuidV4Pattern.MatchString(id) {
			t.Errorf("TraceID() = %q, want UUID v4 format (8-4-4-4-12)", id)
		}
	})

	t.Run("version nibble is 4", func(t *testing.T) {
		id := TraceID()
		// The third group starts with '4' for UUID v4
		parts := strings.Split(id, "-")
		if len(parts) != 5 {
			t.Fatalf("TraceID() = %q, expected 5 dash-separated parts", id)
		}
		if len(parts[2]) != 4 || parts[2][0] != '4' {
			t.Errorf("TraceID() = %q, version nibble should be 4xxx, got %q", id, parts[2])
		}
	})

	t.Run("variant bits are 10xx", func(t *testing.T) {
		id := TraceID()
		parts := strings.Split(id, "-")
		if len(parts) != 5 {
			t.Fatalf("TraceID() = %q, expected 5 dash-separated parts", id)
		}
		// The fourth group should start with 8, 9, a, or b (10xx in binary)
		firstNibble := parts[3][0]
		if firstNibble != '8' && firstNibble != '9' && firstNibble != 'a' && firstNibble != 'b' {
			t.Errorf("TraceID() = %q, variant nibble should be 8/b/a/b, got %c", id, firstNibble)
		}
	})

	t.Run("process-wide singleton", func(t *testing.T) {
		id1 := TraceID()
		id2 := TraceID()
		if id1 != id2 {
			t.Errorf("TraceID() changed between calls: %q -> %q", id1, id2)
		}
	})
}

func TestGetRandomURLPath(t *testing.T) {
	first, err := GetRandomURLPath()
	if err != nil {
		t.Fatalf("GetRandomURLPath() error = %v", err)
	}
	second, err := GetRandomURLPath()
	if err != nil {
		t.Fatalf("GetRandomURLPath() error = %v", err)
	}
	if first == second {
		t.Fatal("GetRandomURLPath() returned the same value twice")
	}
	if len(first) < 20 {
		t.Fatalf("GetRandomURLPath() length = %d, want at least 20", len(first))
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(first) {
		t.Fatalf("GetRandomURLPath() = %q, want URL-safe characters only", first)
	}
}
