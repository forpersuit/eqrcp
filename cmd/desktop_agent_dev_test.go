package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"eqt/pkg/application"
)

// devTestAgent builds a desktopAgent wired to a temp HOME so /dev/* handlers
// read settings from a controlled location and write dumps we can inspect.
func devTestAgent(t *testing.T, dev bool) *desktopAgent {
	t.Helper()
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	base := application.Flags{}
	agent := newDesktopAgent(base)

	settings, err := agent.readSettings()
	if err != nil {
		t.Fatalf("readSettings: %v", err)
	}
	settings.DevMode = dev
	settings.DebugLog = false
	if _, err := agent.writeSettings(settings); err != nil {
		t.Fatalf("writeSettings: %v", err)
	}
	_ = agent.loadHistory()
	return agent
}

func TestDevCrashDumpEndpoint(t *testing.T) {
	agent := devTestAgent(t, true)

	// GET /dev/crash/dump with no dump → hasPending:false
	req := httptest.NewRequest(http.MethodGet, "/dev/crash/dump", nil)
	rec := httptest.NewRecorder()
	agent.handleDevCrashDump(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if body["hasPending"] != false {
		t.Errorf("hasPending = %v, want false", body["hasPending"])
	}

	// Trigger → dump appears → GET shows pending
	req = httptest.NewRequest(http.MethodPost, "/dev/crash/trigger", nil)
	rec = httptest.NewRecorder()
	agent.handleDevCrashTrigger(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("trigger status = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/dev/crash/dump", nil)
	rec = httptest.NewRecorder()
	agent.handleDevCrashDump(rec, req)
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if body["hasPending"] != true {
		t.Errorf("hasPending = %v, want true after trigger", body["hasPending"])
	}
	if _, ok := body["report"]; !ok {
		t.Error("expected report payload in dump response")
	}
}

func TestDevCrashGuardNonDev(t *testing.T) {
	agent := devTestAgent(t, false)

	// DevMode off → all /dev/* endpoints return 403
	req := httptest.NewRequest(http.MethodGet, "/dev/crash/dump", nil)
	rec := httptest.NewRecorder()
	agent.handleDevCrashDump(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("dump status = %d, want 403 when dev disabled", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/dev/crash/trigger", nil)
	rec = httptest.NewRecorder()
	agent.handleDevCrashTrigger(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("trigger status = %d, want 403 when dev disabled", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/dev/crash/report", nil)
	rec = httptest.NewRecorder()
	agent.handleDevCrashReport(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("report status = %d, want 403 when dev disabled", rec.Code)
	}
}

func TestDevCrashReportEndpoint(t *testing.T) {
	agent := devTestAgent(t, true)

	// Point EQT_CRASH_SERVER at a local capture server and verify the
	// synthesized report uploads end to end.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"received","report_id":"dev-report-1"}`))
	}))
	defer srv.Close()
	t.Setenv("EQT_CRASH_SERVER", srv.URL+"/api/v1/crash-report")

	req := httptest.NewRequest(http.MethodPost, "/dev/crash/report", nil)
	rec := httptest.NewRecorder()
	agent.handleDevCrashReport(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("report status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if body["submitted"] != true || body["report_id"] != "dev-report-1" {
		t.Errorf("unexpected response: %+v", body)
	}
}

func TestDevCrashReportFailure(t *testing.T) {
	agent := devTestAgent(t, true)

	// Unreachable target → handler surfaces the failure as 502.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	addr := srv.URL
	srv.Close()
	t.Setenv("EQT_CRASH_SERVER", addr)

	req := httptest.NewRequest(http.MethodPost, "/dev/crash/report", nil)
	rec := httptest.NewRecorder()
	agent.handleDevCrashReport(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Errorf("report status = %d, want 502 on submit failure: %s", rec.Code, rec.Body.String())
	}
}

func TestDevCrashMethodNotAllowed(t *testing.T) {
	agent := devTestAgent(t, true)

	req := httptest.NewRequest(http.MethodGet, "/dev/crash/trigger", bytes.NewReader(nil))
	rec := httptest.NewRecorder()
	agent.handleDevCrashTrigger(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("trigger GET status = %d, want 405", rec.Code)
	}
}
