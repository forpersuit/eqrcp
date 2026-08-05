package crash

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestReadLogTail tests reading the last N lines from a log file.
func TestReadLogTail(t *testing.T) {
	t.Run("empty file", func(t *testing.T) {
		dir := t.TempDir()
		f := filepath.Join(dir, "test.log")
		_ = os.WriteFile(f, []byte{}, 0644)
		got := ReadLogTail(f, 10)
		if got != "" {
			t.Errorf("expected empty string, got %q", got)
		}
	})

	t.Run("file shorter than n", func(t *testing.T) {
		dir := t.TempDir()
		f := filepath.Join(dir, "test.log")
		_ = os.WriteFile(f, []byte("line1\nline2\n"), 0644)
		got := ReadLogTail(f, 10)
		if got != "line1\nline2\n" {
			t.Errorf("expected full content, got %q", got)
		}
	})

	t.Run("file longer than n", func(t *testing.T) {
		dir := t.TempDir()
		f := filepath.Join(dir, "test.log")
		lines := make([]string, 100)
		for i := range 100 {
			lines[i] = "line"
		}
		_ = os.WriteFile(f, []byte(strings.Join(lines, "\n")), 0644)
		got := ReadLogTail(f, 50)
		gotLines := strings.Split(strings.TrimRight(got, "\n"), "\n")
		if len(gotLines) != 50 {
			t.Errorf("expected 50 lines, got %d", len(gotLines))
		}
	})

	t.Run("nonexistent file", func(t *testing.T) {
		got := ReadLogTail("/nonexistent/path.log", 10)
		if got != "" {
			t.Errorf("expected empty string for nonexistent file, got %q", got)
		}
	})

	t.Run("empty path", func(t *testing.T) {
		got := ReadLogTail("", 10)
		if got != "" {
			t.Errorf("expected empty string for empty path, got %q", got)
		}
	})
}

// TestSaveAndLoadDump tests writing and reading a crash dump file.
func TestSaveAndLoadDump(t *testing.T) {
	// Use a temp HOME to redirect DefaultConfigDir
	tempHome := t.TempDir()
	oldHome := os.Getenv("HOME")
	os.Setenv("HOME", tempHome)
	defer os.Setenv("HOME", oldHome)

	// Save a dump
	SaveDump("test panic: something went wrong")

	// Load it back
	dump, err := LoadDump()
	if err != nil {
		t.Fatalf("LoadDump failed: %v", err)
	}
	if dump == nil {
		t.Fatal("LoadDump returned nil, expected a dump")
	}

	if !strings.Contains(dump.Report.StackTrace, "test panic: something went wrong") {
		t.Errorf("stack trace missing panic message, got: %s", dump.Report.StackTrace)
	}
	if dump.Report.AppVersion == "" {
		t.Error("AppVersion should not be empty")
	}
	if dump.Report.OSVersion == "" {
		t.Error("OSVersion should not be empty")
	}
	if dump.Report.Timestamp == "" {
		t.Error("Timestamp should not be empty")
	}
	if dump.Uploaded {
		t.Error("Uploaded should be false for a new dump")
	}
	if dump.Dismissed {
		t.Error("Dismissed should be false for a new dump")
	}
}

// TestHasPendingDump tests the pending dump detection.
func TestHasPendingDump(t *testing.T) {
	t.Run("no dump file", func(t *testing.T) {
		tempHome := t.TempDir()
		oldHome := os.Getenv("HOME")
		os.Setenv("HOME", tempHome)
		defer os.Setenv("HOME", oldHome)

		if HasPendingDump() {
			t.Error("HasPendingDump should be false when no dump exists")
		}
	})

	t.Run("dump exists and not uploaded", func(t *testing.T) {
		tempHome := t.TempDir()
		oldHome := os.Getenv("HOME")
		os.Setenv("HOME", tempHome)
		defer os.Setenv("HOME", oldHome)

		SaveDump("panic")
		if !HasPendingDump() {
			t.Error("HasPendingDump should be true after SaveDump")
		}
	})

	t.Run("dump marked as uploaded", func(t *testing.T) {
		tempHome := t.TempDir()
		oldHome := os.Getenv("HOME")
		os.Setenv("HOME", tempHome)
		defer os.Setenv("HOME", oldHome)

		SaveDump("panic")
		_ = MarkUploaded()
		if HasPendingDump() {
			t.Error("HasPendingDump should be false after MarkUploaded")
		}
	})

	t.Run("dump marked as dismissed", func(t *testing.T) {
		tempHome := t.TempDir()
		oldHome := os.Getenv("HOME")
		os.Setenv("HOME", tempHome)
		defer os.Setenv("HOME", oldHome)

		SaveDump("panic")
		_ = MarkDismissed()
		if HasPendingDump() {
			t.Error("HasPendingDump should be false after MarkDismissed")
		}
	})
}

// TestClearDump tests removing the crash dump file.
func TestClearDump(t *testing.T) {
	tempHome := t.TempDir()
	oldHome := os.Getenv("HOME")
	os.Setenv("HOME", tempHome)
	defer os.Setenv("HOME", oldHome)

	SaveDump("panic")
	if !HasPendingDump() {
		t.Fatal("expected pending dump after SaveDump")
	}

	if err := ClearDump(); err != nil {
		t.Fatalf("ClearDump failed: %v", err)
	}

	if HasPendingDump() {
		t.Error("HasPendingDump should be false after ClearDump")
	}
}

// TestLoadRawDumpAfterDismiss verifies that once a dump is acknowledged
// (MarkDismissed), LoadDump/HasPendingDump hide it so it never prompts again on
// a later launch, while LoadRawDump still returns it so a subsequent Send can
// upload the report.
func TestLoadRawDumpAfterDismiss(t *testing.T) {
	tempHome := t.TempDir()
	oldHome := os.Getenv("HOME")
	os.Setenv("HOME", tempHome)
	defer os.Setenv("HOME", oldHome)

	SaveDump("panic")

	// Acknowledge the crash, as the feedback panel does on open.
	_ = MarkDismissed()

	if HasPendingDump() {
		t.Fatal("HasPendingDump should be false after MarkDismissed")
	}
	if dump, err := LoadDump(); err != nil || dump != nil {
		t.Errorf("LoadDump should return nil after MarkDismissed (err=%v, dump=%v)", err, dump)
	}

	// The raw dump must still be readable so Send can upload the acknowledged report.
	dump, err := LoadRawDump()
	if err != nil {
		t.Fatalf("LoadRawDump failed: %v", err)
	}
	if dump == nil {
		t.Fatal("LoadRawDump returned nil, expected the acknowledged dump")
	}
	if !dump.Dismissed {
		t.Error("LoadRawDump should report the dump as dismissed")
	}
	if !strings.Contains(dump.Report.StackTrace, "panic") {
		t.Errorf("stack trace missing panic message, got: %s", dump.Report.StackTrace)
	}
}

// TestMarkUploadedThenDismissed tests that a dump marked as uploaded
// is not affected by a subsequent MarkDismissed call (it stays not pending).
func TestMarkUploadedThenDismissed(t *testing.T) {
	tempHome := t.TempDir()
	oldHome := os.Getenv("HOME")
	os.Setenv("HOME", tempHome)
	defer os.Setenv("HOME", oldHome)

	SaveDump("panic")
	_ = MarkUploaded()
	_ = MarkDismissed()

	if HasPendingDump() {
		t.Error("HasPendingDump should be false after MarkUploaded + MarkDismissed")
	}
}

// TestCollect verifies that Collect returns a properly structured Report.
func TestCollect(t *testing.T) {
	report := Collect("test stack trace", "test log tail")

	if report.AppVersion == "" {
		t.Error("AppVersion should not be empty")
	}
	if report.OSVersion == "" {
		t.Error("OSVersion should not be empty")
	}
	if report.StackTrace != "test stack trace" {
		t.Errorf("expected 'test stack trace', got %q", report.StackTrace)
	}
	if report.LogTail != "test log tail" {
		t.Errorf("expected 'test log tail', got %q", report.LogTail)
	}
	if report.Timestamp == "" {
		t.Error("Timestamp should not be empty")
	}
}

// TestSaveDumpWithNil tests that SaveDump handles nil recovery gracefully.
func TestSaveDumpWithNil(t *testing.T) {
	tempHome := t.TempDir()
	oldHome := os.Getenv("HOME")
	os.Setenv("HOME", tempHome)
	defer os.Setenv("HOME", oldHome)

	// SaveDump(nil) simulates a signal-triggered crash
	SaveDump(nil)

	dump, err := LoadDump()
	if err != nil {
		t.Fatalf("LoadDump failed: %v", err)
	}
	if dump == nil {
		t.Fatal("LoadDump returned nil, expected a dump")
	}

	if !strings.Contains(dump.Report.StackTrace, "crash: SIGABRT or fatal error") {
		t.Errorf("expected SIGABRT message in stack trace, got: %s", dump.Report.StackTrace)
	}
}

// TestSetTraceIDHeader verifies that SetTraceIDHeader sets a valid UUID v4 trace ID.
func TestSetTraceIDHeader(t *testing.T) {
	req, err := http.NewRequest("GET", "/", nil)
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}

	SetTraceIDHeader(req)

	traceID := req.Header.Get("X-Trace-Id")
	if traceID == "" {
		t.Fatal("SetTraceIDHeader did not set X-Trace-Id header")
	}
	// UUID v4 format: 8-4-4-4-12 hex digits, version nibble 4, variant 8/9/a/b
	uuidV4 := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	if !uuidV4.MatchString(traceID) {
		t.Errorf("SetTraceIDHeader set X-Trace-Id = %q, want UUID v4 format", traceID)
	}
}
