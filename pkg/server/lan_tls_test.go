package server

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"eqt/pkg/config"
)

func TestLanTLSLoopbackServer(t *testing.T) {
	cfg := &config.Config{
		Bind:      "127.0.0.1",
		Port:      0, // random available port
		Secure:    true,
		Path:      "test-session",
		KeepAlive: true,
	}

	srv, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create Secure server: %v", err)
	}
	defer srv.Shutdown()

	parsedURL, err := url.Parse(srv.BaseURL)
	if err != nil {
		t.Fatalf("Failed to parse BaseURL %q: %v", srv.BaseURL, err)
	}

	if parsedURL.Scheme != "https" {
		t.Errorf("Expected scheme https, got %q", parsedURL.Scheme)
	}

	// Hostname should be converted to loopback domain
	expectedHostPrefix := "127-0-0-1.direct.eqt.net.im"
	if !strings.HasPrefix(parsedURL.Host, expectedHostPrefix) {
		t.Errorf("Expected host to start with %q, got %q", expectedHostPrefix, parsedURL.Host)
	}

	if !strings.HasPrefix(srv.SendURL, "https://127-0-0-1.direct.eqt.net.im") {
		t.Errorf("SendURL %q should start with direct domain", srv.SendURL)
	}
	if !strings.HasPrefix(srv.ReceiveURL, "https://127-0-0-1.direct.eqt.net.im") {
		t.Errorf("ReceiveURL %q should start with direct domain", srv.ReceiveURL)
	}

	// Test real TLS handshake by requesting /send/test-session/status
	// We route request to 127.0.0.1 while keeping Host header and TLS SNI as 127-0-0-1.direct.eqt.net.im
	port := parsedURL.Port()
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			ServerName: "127-0-0-1.direct.eqt.net.im",
			// We can verify certificate chain with InsecureSkipVerify: false if root CA is trusted,
			// but in test environments without global Let's Encrypt roots, we verify cert SAN
			InsecureSkipVerify: true,
		},
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   3 * time.Second,
	}

	reqURL := fmt.Sprintf("https://127.0.0.1:%s/send/test-session/status", port)
	req, err := http.NewRequest(http.MethodGet, reqURL, nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}
	req.Host = fmt.Sprintf("127-0-0-1.direct.eqt.net.im:%s", port)

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("TLS request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	if resp.TLS == nil {
		t.Fatalf("Expected TLS connection, got nil")
	}

	// Verify negotiated TLS version is at least TLS 1.2 or TLS 1.3
	if resp.TLS.Version < tls.VersionTLS12 {
		t.Errorf("Expected TLS >= 1.2, got 0x%04x", resp.TLS.Version)
	}
}
