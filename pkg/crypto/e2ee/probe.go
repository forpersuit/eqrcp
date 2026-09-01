package e2ee

import (
	"context"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"
)

const (
	DefaultProbeDelay = 30 * time.Second
	ProbeTimeout      = 5 * time.Second
)

var (
	drmOnline atomic.Bool
)

func init() {
	// Default to optimistic online until first probe
	drmOnline.Store(true)
}

// GetDRMBaseURL returns the base URL for the DRM service.
func GetDRMBaseURL() string {
	if custom := strings.TrimSpace(os.Getenv("EQT_DRM_URL")); custom != "" {
		return strings.TrimRight(custom, "/")
	}
	return DefaultDRMURL
}

// IsDRMOnline reports whether the DRM service is currently reachable.
func IsDRMOnline() bool {
	return drmOnline.Load()
}

// SetDRMOnline sets the cached online status directly (useful for tests/mocks).
func SetDRMOnline(online bool) {
	drmOnline.Store(online)
}

// CheckDRMHealthWithTimeout performs a health probe against DRM server with custom timeout.
func CheckDRMHealthWithTimeout(baseURL string, timeout time.Duration) bool {
	if timeout <= 0 {
		timeout = ProbeTimeout
	}
	if baseURL == "" {
		baseURL = GetDRMBaseURL()
	}
	fastClient := &http.Client{
		Timeout: timeout,
	}
	url := strings.TrimRight(baseURL, "/") + "/health"
	req, err := http.NewRequest("HEAD", url, nil)
	if err != nil {
		return false
	}
	req.Header.Set("User-Agent", "EQT-DRM-Probe/1.0")

	resp, err := fastClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

// CheckDRMHealth performs a single synchronous health probe against the DRM server.
func CheckDRMHealth(baseURL string) bool {
	return CheckDRMHealthWithTimeout(baseURL, ProbeTimeout)
}

// StartDRMProber starts a background goroutine to probe DRM health every 30s.
func StartDRMProber(ctx context.Context, customURL string, interval time.Duration, onChange func(bool)) {
	if interval <= 0 {
		interval = DefaultProbeDelay
	}

	go func() {
		// Immediate initial probe
		initialStatus := CheckDRMHealth(customURL)
		old := drmOnline.Swap(initialStatus)
		if old != initialStatus && onChange != nil {
			onChange(initialStatus)
		}

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				current := CheckDRMHealth(customURL)
				prev := drmOnline.Swap(current)
				if prev != current && onChange != nil {
					onChange(current)
				}
			}
		}
	}()
}
