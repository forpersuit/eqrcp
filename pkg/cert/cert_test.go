package cert

import (
	"crypto/x509"
	"testing"
	"time"
)

func TestFormatDirectDomain(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"192.168.0.201", "192-168-0-201.direct.eqt.net.im"},
		{"10.0.0.1", "10-0-0-1.direct.eqt.net.im"},
		{"172.16.5.99", "172-16-5-99.direct.eqt.net.im"},
		{"127.0.0.1", "127-0-0-1.direct.eqt.net.im"},
		{"invalid-ip", "invalid-ip"},
		{"::1", "::1"},
		{"2607:f130::1", "2607:f130::1"},
	}

	for _, tc := range cases {
		got := FormatDirectDomain(tc.input)
		if got != tc.expected {
			t.Errorf("FormatDirectDomain(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestGetCertificateCached(t *testing.T) {
	cert, err := GetCertificate("", "")
	if err != nil {
		t.Skipf("No cached certificate available on this machine: %v", err)
	}

	if len(cert.Certificate) == 0 {
		t.Fatalf("Certificate chain is empty")
	}

	x509Cert, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatalf("Failed to parse leaf certificate: %v", err)
	}

	expiry, err := GetCertificateExpiry(cert)
	if err != nil {
		t.Fatalf("Failed to get certificate expiry: %v", err)
	}

	if expiry.Before(time.Now()) {
		t.Fatalf("Certificate is expired: %v", expiry)
	}

	hasWildcard := false
	for _, san := range x509Cert.DNSNames {
		if san == "*.direct.eqt.net.im" {
			hasWildcard = true
			break
		}
	}
	if !hasWildcard {
		t.Errorf("Certificate missing wildcard SAN *.direct.eqt.net.im, got: %v", x509Cert.DNSNames)
	}
}
