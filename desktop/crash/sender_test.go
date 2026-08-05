package crash

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// submitTestReport returns a fully-populated Report used to verify the
// wire contract of Submit: every field a production crash would carry.
func submitTestReport() Report {
	return Report{
		AppVersion:  "1.19.0",
		OSVersion:   "windows/amd64",
		StackTrace:  "panic: boom\n\ngoroutine 1 [running]:",
		LogTail:     "line1\nline2",
		DeviceID:    "dev-123",
		LicenseCode: "EQT-ABCD-EFGH",
		Timestamp:   "2026-08-05T00:00:00+08:00",
	}
}

// TestSubmitRequestContract verifies that Submit POSTs the exact JSON body
// the backend /api/v1/crash-report endpoint expects (all fields present),
// and that the response parsing accepts a well-formed success payload.
func TestSubmitRequestContract(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/crash-report" {
			t.Errorf("expected path /api/v1/crash-report, got %s", r.URL.Path)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected Content-Type application/json, got %q", ct)
		}

		var got Report
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("invalid JSON body: %v", err)
		}

		if got.AppVersion != "1.19.0" {
			t.Errorf("app_version = %q, want 1.19.0", got.AppVersion)
		}
		if got.OSVersion != "windows/amd64" {
			t.Errorf("os_version = %q, want windows/amd64", got.OSVersion)
		}
		if !strings.Contains(got.StackTrace, "panic: boom") {
			t.Errorf("stack_trace = %q, want panic message", got.StackTrace)
		}
		if got.LogTail != "line1\nline2" {
			t.Errorf("log_tail = %q, want line1\\nline2", got.LogTail)
		}
		if got.DeviceID != "dev-123" {
			t.Errorf("device_id = %q, want dev-123", got.DeviceID)
		}
		if got.LicenseCode != "EQT-ABCD-EFGH" {
			t.Errorf("license_code = %q, want EQT-ABCD-EFGH", got.LicenseCode)
		}
		if got.Timestamp == "" {
			t.Error("timestamp should not be empty")
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"received","report_id":"report-abc"}`))
	}))
	defer srv.Close()

	// The production default is a full URL including the endpoint path;
	// mirror that so the path contract below is asserted against the real shape.
	t.Setenv("EQT_CRASH_SERVER", srv.URL+"/api/v1/crash-report")

	id, err := Submit(submitTestReport())
	if err != nil {
		t.Fatalf("Submit failed: %v", err)
	}
	if id != "report-abc" {
		t.Errorf("report_id = %q, want report-abc", id)
	}
}

// TestSubmitServerError verifies that a non-200 response surfaces as an
// error carrying the HTTP status code.
func TestSubmitServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	t.Setenv("EQT_CRASH_SERVER", srv.URL)

	_, err := Submit(submitTestReport())
	if err == nil {
		t.Fatal("expected error for HTTP 500, got nil")
	}
	if !strings.Contains(err.Error(), "status 500") {
		t.Errorf("error = %q, want it to mention status 500", err.Error())
	}
}

// TestSubmitUnexpectedStatus verifies that a 200 with an unknown status
// value is rejected rather than silently accepted.
func TestSubmitUnexpectedStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"nope","report_id":"report-xyz"}`))
	}))
	defer srv.Close()

	t.Setenv("EQT_CRASH_SERVER", srv.URL)

	_, err := Submit(submitTestReport())
	if err == nil {
		t.Fatal("expected error for unexpected status, got nil")
	}
	if !strings.Contains(err.Error(), "unexpected status") {
		t.Errorf("error = %q, want it to mention unexpected status", err.Error())
	}
}

// TestSubmitMalformedResponse verifies that an unparseable 200 body is
// reported as a parsing error rather than a silent success.
func TestSubmitMalformedResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`not-json`))
	}))
	defer srv.Close()

	t.Setenv("EQT_CRASH_SERVER", srv.URL)

	_, err := Submit(submitTestReport())
	if err == nil {
		t.Fatal("expected error for malformed response, got nil")
	}
	if !strings.Contains(err.Error(), "parse crash report response") {
		t.Errorf("error = %q, want it to mention response parsing", err.Error())
	}
}

// TestSubmitNetworkError verifies that an unreachable server produces an
// error (the fail-loud path when a crash report cannot be delivered).
func TestSubmitNetworkError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	addr := srv.URL
	srv.Close() // force connection refused

	t.Setenv("EQT_CRASH_SERVER", addr)

	_, err := Submit(submitTestReport())
	if err == nil {
		t.Fatal("expected error for unreachable server, got nil")
	}
	if !strings.Contains(err.Error(), "failed to submit crash report") {
		t.Errorf("error = %q, want it to mention submission failure", err.Error())
	}
}

// TestSubmitAndCleanMarksUploaded verifies the end-to-end success path:
// SubmitAndClean uploads successfully AND marks the pending dump uploaded
// so a later startup will not re-prompt.
func TestSubmitAndCleanMarksUploaded(t *testing.T) {
	tempHome := t.TempDir()
	oldHome := os.Getenv("HOME")
	os.Setenv("HOME", tempHome)
	defer os.Setenv("HOME", oldHome)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"received","report_id":"report-uploaded"}`))
	}))
	defer srv.Close()
	t.Setenv("EQT_CRASH_SERVER", srv.URL)

	SaveDump("test panic")
	if !HasPendingDump() {
		t.Fatal("expected pending dump before SubmitAndClean")
	}

	id, err := SubmitAndClean(submitTestReport())
	if err != nil {
		t.Fatalf("SubmitAndClean failed: %v", err)
	}
	if id != "report-uploaded" {
		t.Errorf("report_id = %q, want report-uploaded", id)
	}

	if HasPendingDump() {
		t.Error("dump should no longer be pending after successful upload")
	}
}
