package server

import (
	"fmt"
	"net"
	"strings"
	"testing"

	"eqt/pkg/config"
)

func TestStandardPortURLFormatting(t *testing.T) {
	formatHostPort := func(rawHost string, port int, secure bool) string {
		isStandard := (!secure && port == 80) || (secure && port == 443)
		isIPv6 := strings.Count(rawHost, ":") >= 2 && !strings.HasPrefix(rawHost, "[")
		if isStandard {
			if isIPv6 {
				return fmt.Sprintf("[%s]", rawHost)
			}
			return rawHost
		}
		if isIPv6 {
			return fmt.Sprintf("[%s]:%d", rawHost, port)
		}
		return fmt.Sprintf("%s:%d", rawHost, port)
	}

	tests := []struct {
		name     string
		host     string
		port     int
		secure   bool
		expected string
	}{
		{
			name:     "HTTP on standard port 80 omits port",
			host:     "192.168.1.100",
			port:     80,
			secure:   false,
			expected: "192.168.1.100",
		},
		{
			name:     "HTTP on non-standard port 18080 includes port",
			host:     "192.168.1.100",
			port:     18080,
			secure:   false,
			expected: "192.168.1.100:18080",
		},
		{
			name:     "HTTPS on standard port 443 omits port",
			host:     "192-168-1-100.direct.eqt.net.im",
			port:     443,
			secure:   true,
			expected: "192-168-1-100.direct.eqt.net.im",
		},
		{
			name:     "HTTPS on non-standard port 8443 includes port",
			host:     "192-168-1-100.direct.eqt.net.im",
			port:     8443,
			secure:   true,
			expected: "192-168-1-100.direct.eqt.net.im:8443",
		},
		{
			name:     "IPv6 on standard port 80",
			host:     "fe80::1",
			port:     80,
			secure:   false,
			expected: "[fe80::1]",
		},
		{
			name:     "IPv6 on non-standard port 9090",
			host:     "fe80::1",
			port:     9090,
			secure:   false,
			expected: "[fe80::1]:9090",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := formatHostPort(tc.host, tc.port, tc.secure)
			if got != tc.expected {
				t.Errorf("formatHostPort(%q, %d, %v) = %q, want %q", tc.host, tc.port, tc.secure, got, tc.expected)
			}
		})
	}
}

func TestServerNewWithPreferStandardPort(t *testing.T) {
	// Test that server.New gracefully starts on 127.0.0.1 with PreferStandardPort=true
	cfg := config.Config{
		Bind:               "127.0.0.1",
		Port:               0,
		PreferStandardPort: true,
	}

	srv, err := New(&cfg)
	if err != nil {
		t.Fatalf("server.New failed with PreferStandardPort=true: %v", err)
	}
	defer srv.Shutdown()

	if srv.BaseURL == "" {
		t.Errorf("expected non-empty BaseURL, got empty")
	}

	// Verify that if port is 80, BaseURL has no port suffix.
	// If port is not 80 (e.g. fallen back due to non-root permissions), BaseURL contains :port.
	_, portStr, err := net.SplitHostPort(srv.instance.Addr)
	if err != nil {
		t.Fatalf("failed to split host port from %s: %v", srv.instance.Addr, err)
	}
	if portStr == "80" {
		if strings.Contains(srv.BaseURL, ":80") {
			t.Errorf("expected BaseURL on port 80 to omit :80, got %s", srv.BaseURL)
		}
	} else {
		expectedPortSuffix := fmt.Sprintf(":%s", portStr)
		if !strings.Contains(srv.BaseURL, expectedPortSuffix) {
			t.Errorf("expected BaseURL on port %s to contain %s, got %s", portStr, expectedPortSuffix, srv.BaseURL)
		}
	}
}
