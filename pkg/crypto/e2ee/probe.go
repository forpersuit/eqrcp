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
	DefaultDRMURL     = "https://drm.eqt.net.im"
	DefaultProbeDelay = 30 * time.Second
	ProbeTimeout      = 5 * time.Second
)

var (
	drmOnline atomic.Bool
	client    = &http.Client{
		Timeout: ProbeTimeout,
	}
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

// CheckDRMHealth performs a single synchronous health probe against the DRM server.
func CheckDRMHealth(baseURL string) bool {
	if baseURL == "" {
		baseURL = GetDRMBaseURL()
	}
	url := strings.TrimRight(baseURL, "/") + "/health"
	req, err := http.NewRequest("HEAD", url, nil)
	if err != nil {
		return false
	}
	req.Header.Set("User-Agent", "EQT-DRM-Probe/1.0")

	resp, err := client.Do(req)
	if err != nil {
		// Fallback to GET in case server blocks HEAD
		reqGET, errGET := http.NewRequest("GET", url, nil)
		if errGET != nil {
			return false
		}
		resp, err = client.Do(reqGET)
		if err != nil {
			return false
		}
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
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
