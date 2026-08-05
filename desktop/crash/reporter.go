// Package crash provides desktop crash report collection and submission.
//
// Usage:
//
//	On panic:  crash.SaveDump(recoveredValue)  → writes crash.dump to app data dir
//	On startup: crash.CheckAndReport()          → if crash.dump exists, prompts user to upload
package crash

import (
	"encoding/json"
	"eqt/pkg/util"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"time"

	"eqt/pkg/config"
	"eqt/pkg/server"
	"eqt/pkg/version"
)

// TraceID returns the process-wide trace ID, delegating to util.TraceID().
func TraceID() string {
	return util.TraceID()
}

// SetTraceIDHeader sets the X-Trace-Id header on an HTTP request.
func SetTraceIDHeader(req *http.Request) {
	req.Header.Set("X-Trace-Id", TraceID())
}

// Report represents a collected crash report ready for submission.
type Report struct {
	AppVersion  string `json:"app_version"`
	OSVersion   string `json:"os_version"`
	StackTrace  string `json:"stack_trace"`
	LogTail     string `json:"log_tail,omitempty"`
	DeviceID    string `json:"device_id,omitempty"`
	LicenseCode string `json:"license_code,omitempty"`
	Timestamp   string `json:"timestamp"`
}

// DumpFile is the on-disk format for pending crash dumps.
type DumpFile struct {
	Report    Report `json:"report"`
	Uploaded  bool   `json:"uploaded"`
	Dismissed bool   `json:"dismissed"`
}

// dumpFilePath returns the path to the crash dump file.
func dumpFilePath() string {
	return filepath.Join(config.DefaultConfigDir(), "crash.dump")
}

// Collect gathers diagnostic information at crash time.
// It reads the current state (version, OS, stack, device, license) and returns a Report.
// logTail is optional — pass the last N lines of the desktop log if available.
func Collect(stackTrace string, logTail string) Report {
	report := Report{
		AppVersion: version.Version(),
		OSVersion:  fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH),
		StackTrace: stackTrace,
		LogTail:    logTail,
		Timestamp:  time.Now().Format(time.RFC3339),
	}

	// Collect device ID if available
	report.DeviceID = server.GetDeviceStableID()

	// Collect license code if available
	if cert, ok := server.GetLocalLicenseInfo(); ok {
		report.LicenseCode = cert.LicenseCode
	}

	return report
}

// SaveDump writes a crash dump to disk for later upload.
// This is called from a panic recovery handler — it should not panic itself.
func SaveDump(recovered any) {
	stack := string(debug.Stack())
	var msg string
	if recovered != nil {
		msg = fmt.Sprintf("panic: %v", recovered)
	} else {
		msg = "crash: SIGABRT or fatal error"
	}
	fullTrace := msg + "\n" + stack

	report := Collect(fullTrace, "")

	dump := DumpFile{
		Report:   report,
		Uploaded: false,
	}

	data, err := json.MarshalIndent(dump, "", "  ")
	if err != nil {
		return
	}

	path := dumpFilePath()
	_ = os.MkdirAll(filepath.Dir(path), 0755)
	_ = os.WriteFile(path, data, 0644)
}

// LoadDump reads a pending crash dump from disk.
func LoadDump() (*DumpFile, error) {
	path := dumpFilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var dump DumpFile
	if err := json.Unmarshal(data, &dump); err != nil {
		return nil, err
	}

	if dump.Uploaded || dump.Dismissed {
		return nil, nil
	}

	return &dump, nil
}

// MarkUploaded marks the crash dump as uploaded (so it won't be prompted again).
func MarkUploaded() error {
	path := dumpFilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	var dump DumpFile
	if err := json.Unmarshal(data, &dump); err != nil {
		return err
	}

	dump.Uploaded = true
	updated, err := json.MarshalIndent(dump, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, updated, 0644)
}

// MarkDismissed marks the crash dump as dismissed (so it won't be prompted again).
func MarkDismissed() error {
	path := dumpFilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	var dump DumpFile
	if err := json.Unmarshal(data, &dump); err != nil {
		return err
	}

	dump.Dismissed = true
	updated, err := json.MarshalIndent(dump, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, updated, 0644)
}

// ClearDump removes the crash dump file entirely.
func ClearDump() error {
	return os.Remove(dumpFilePath())
}

// HasPendingDump returns true if there is an un-uploaded crash dump on disk.
func HasPendingDump() bool {
	dump, err := LoadDump()
	return err == nil && dump != nil
}
