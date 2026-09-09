package cert

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGetNodeDomain(t *testing.T) {
	cases := []struct {
		nodeID   string
		expected string
	}{
		{"a1b2c3d4e5f6", "a1b2c3d4e5f6.direct.eqt.net.im"},
		{"A1B2C3D4E5F6", "a1b2c3d4e5f6.direct.eqt.net.im"},
		{"  node123  ", "node123.direct.eqt.net.im"},
		{"", "direct.eqt.net.im"},
	}

	for _, tc := range cases {
		got := GetNodeDomain(tc.nodeID)
		if got != tc.expected {
			t.Errorf("GetNodeDomain(%q) = %q, want %q", tc.nodeID, got, tc.expected)
		}
	}
}

func TestFormatDirectDomainWithNode(t *testing.T) {
	cases := []struct {
		ip       string
		nodeID   string
		expected string
	}{
		{"192.168.0.201", "a1b2c3d4e5f6", "192-168-0-201.a1b2c3d4e5f6.direct.eqt.net.im"},
		{"10.0.0.1", "NODE999", "10-0-0-1.node999.direct.eqt.net.im"},
		{"172.16.1.5", "", "172-16-1-5.direct.eqt.net.im"},
		{"127.0.0.1", "   ", "127-0-0-1.direct.eqt.net.im"},
		{"invalid-ip", "node1", "invalid-ip"},
		{"::1", "node1", "::1"},
	}

	for _, tc := range cases {
		got := FormatDirectDomainWithNode(tc.ip, tc.nodeID)
		if got != tc.expected {
			t.Errorf("FormatDirectDomainWithNode(%q, %q) = %q, want %q", tc.ip, tc.nodeID, got, tc.expected)
		}
	}
}

func TestLoadOrGenerateDeviceKey(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	nodeID := "testnode1234"

	// 1. First generation: creates new key file
	priv1, err := LoadOrGenerateDeviceKey(nodeID)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	if priv1 == nil || priv1.Curve != elliptic.P256() {
		t.Fatalf("expected valid P-256 private key")
	}

	// Verify file permissions
	keyPath := filepath.Join(tempHome, ".config", "eqt", "certs", nodeID, "privkey.pem")
	info, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("key file does not exist: %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Errorf("expected key file permissions 0600, got %o", info.Mode().Perm())
	}

	// 2. Idempotent load: second invocation returns the exact same key
	priv2, err := LoadOrGenerateDeviceKey(nodeID)
	if err != nil {
		t.Fatalf("failed to load existing key: %v", err)
	}
	if !priv1.PublicKey.Equal(&priv2.PublicKey) {
		t.Fatalf("expected identical public key on reload")
	}
}

func TestGenerateDeviceCSR(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	nodeID := "a1b2c3d4e5f6"
	priv, err := LoadOrGenerateDeviceKey(nodeID)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	// Generate CSR
	csrPEM, err := GenerateDeviceCSR(priv, nodeID)
	if err != nil {
		t.Fatalf("failed to generate CSR: %v", err)
	}

	// Decode PEM
	block, _ := pem.Decode(csrPEM)
	if block == nil || block.Type != "CERTIFICATE REQUEST" {
		t.Fatalf("invalid CSR PEM block")
	}

	// Parse CSR
	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		t.Fatalf("failed to parse CSR: %v", err)
	}

	// Verify Subject CommonName
	expectedCN := "a1b2c3d4e5f6.direct.eqt.net.im"
	if csr.Subject.CommonName != expectedCN {
		t.Errorf("expected CommonName %q, got %q", expectedCN, csr.Subject.CommonName)
	}

	// Verify SAN DNSNames
	expectedSANs := []string{"a1b2c3d4e5f6.direct.eqt.net.im", "*.a1b2c3d4e5f6.direct.eqt.net.im"}
	if len(csr.DNSNames) != 2 || csr.DNSNames[0] != expectedSANs[0] || csr.DNSNames[1] != expectedSANs[1] {
		t.Errorf("expected SANs %v, got %v", expectedSANs, csr.DNSNames)
	}

	// Verify Signature
	if err := csr.CheckSignature(); err != nil {
		t.Errorf("CSR signature verification failed: %v", err)
	}
}

func TestSaveAndGetDeviceCertificate(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	nodeID := "node99887766"
	priv, err := LoadOrGenerateDeviceKey(nodeID)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	// 1. Create a self-signed leaf certificate matching this private key
	template := x509.Certificate{
		SerialNumber: big.NewInt(1001),
		Subject: pkix.Name{
			CommonName: "node99887766.direct.eqt.net.im",
		},
		NotBefore: time.Now().Add(-1 * time.Hour),
		NotAfter:  time.Now().Add(90 * 24 * time.Hour),
		DNSNames: []string{
			"node99887766.direct.eqt.net.im",
			"*.node99887766.direct.eqt.net.im",
		},
	}
	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("failed to create test certificate: %v", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})

	// 2. Try to save certificate using a mismatched private key (must fail)
	otherPriv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	mismatchDER, _ := x509.CreateCertificate(rand.Reader, &template, &template, &otherPriv.PublicKey, otherPriv)
	mismatchPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: mismatchDER})

	if err := SaveDeviceCertificate(nodeID, mismatchPEM); err == nil {
		t.Fatalf("expected SaveDeviceCertificate to reject mismatched key, got nil error")
	}

	// 3. Save matching certificate (must succeed)
	if err := SaveDeviceCertificate(nodeID, certPEM); err != nil {
		t.Fatalf("failed to save matching certificate: %v", err)
	}

	// 4. Verify HasValidDeviceCertificate
	if !HasValidDeviceCertificate(nodeID) {
		t.Errorf("expected HasValidDeviceCertificate to return true")
	}

	// 5. Load certificate and verify SANs
	tlsCert, err := GetDeviceCertificate(nodeID)
	if err != nil {
		t.Fatalf("failed to get device certificate: %v", err)
	}
	leaf, err := x509.ParseCertificate(tlsCert.Certificate[0])
	if err != nil {
		t.Fatalf("failed to parse loaded cert: %v", err)
	}
	if leaf.Subject.CommonName != "node99887766.direct.eqt.net.im" {
		t.Errorf("unexpected CommonName: %s", leaf.Subject.CommonName)
	}

	// 6. Test GetActiveCertificate resolution order
	activeCert, activeNode, err := GetActiveCertificate("", "", nodeID)
	if err != nil {
		t.Fatalf("failed to get active certificate: %v", err)
	}
	if activeNode != nodeID {
		t.Errorf("expected activeNode to be %q, got %q", nodeID, activeNode)
	}
	if len(activeCert.Certificate) == 0 {
		t.Errorf("active certificate is empty")
	}
}

func TestRequestDeviceCertificate_SuccessAndReuse(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	nodeID := "nodebeef1234"
	var requestCount int

	// Set up mock Gateway server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++

		if r.Method != http.MethodPost {
			t.Errorf("unexpected method: %s", r.Method)
		}
		if r.Header.Get("X-EQT-Device-ID") != "dev_test_id" {
			t.Errorf("unexpected device ID: %s", r.Header.Get("X-EQT-Device-ID"))
		}
		if r.Header.Get("X-EQT-Hardware-Signature") != "sig_mock" {
			t.Errorf("unexpected signature: %s", r.Header.Get("X-EQT-Hardware-Signature"))
		}

		var payload provisionRequestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}
		if payload.NodeID != nodeID {
			t.Errorf("expected nodeID %s, got %s", nodeID, payload.NodeID)
		}

		// Decode CSR to get the client's public key
		block, _ := pem.Decode([]byte(payload.CSRPEM))
		if block == nil {
			t.Fatalf("invalid CSR PEM block received by mock server")
		}
		csr, err := x509.ParseCertificateRequest(block.Bytes)
		if err != nil {
			t.Fatalf("failed to parse CSR: %v", err)
		}

		// Self-sign a CA/leaf cert with the public key from the CSR
		caPriv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		template := x509.Certificate{
			SerialNumber: big.NewInt(777),
			Subject:      csr.Subject,
			NotBefore:    time.Now().Add(-1 * time.Hour),
			NotAfter:     time.Now().Add(90 * 24 * time.Hour),
			DNSNames:     csr.DNSNames,
		}
		certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, csr.PublicKey, caPriv)
		if err != nil {
			t.Fatalf("failed to create certificate: %v", err)
		}
		certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(provisionResponsePayload{
			CertPEM:   string(certPEM),
			ExpiresAt: template.NotAfter.Format(time.RFC3339),
		})
	}))
	defer server.Close()

	ctx := context.Background()
	var loggedMessages []string
	opts := ProvisionOptions{
		Endpoint:  server.URL,
		NodeID:    nodeID,
		DeviceID:  "dev_test_id",
		Signature: "sig_mock",
		Timeout:   5 * time.Second,
		LogFunc: func(format string, args ...any) {
			loggedMessages = append(loggedMessages, format)
		},
	}

	// 1. First execution: should invoke Gateway, verify key, and commit to disk
	res1, err := RequestDeviceCertificate(ctx, server.Client(), opts)
	if err != nil {
		t.Fatalf("RequestDeviceCertificate failed: %v", err)
	}
	if !res1.IsNew {
		t.Errorf("expected IsNew=true on initial provision")
	}
	if res1.NodeID != nodeID {
		t.Errorf("expected nodeID %q, got %q", nodeID, res1.NodeID)
	}
	if requestCount != 1 {
		t.Errorf("expected 1 gateway request, got %d", requestCount)
	}

	// Verify structured log points
	hasStart := false
	hasSuccess := false
	for _, msg := range loggedMessages {
		if strings.Contains(msg, "[START]") {
			hasStart = true
		}
		if strings.Contains(msg, "[SUCCESS]") {
			hasSuccess = true
		}
	}
	if !hasStart || !hasSuccess {
		t.Errorf("expected structured log markers [START] and [SUCCESS]")
	}

	// 2. Second execution: should REUSE existing certificate without hitting the Gateway
	loggedMessages = nil
	res2, err := RequestDeviceCertificate(ctx, server.Client(), opts)
	if err != nil {
		t.Fatalf("second RequestDeviceCertificate failed: %v", err)
	}
	if res2.IsNew {
		t.Errorf("expected IsNew=false on reused certificate")
	}
	if requestCount != 1 {
		t.Errorf("expected requestCount to remain 1 (no network call on reuse), got %d", requestCount)
	}
	hasReuse := false
	for _, msg := range loggedMessages {
		if strings.Contains(msg, "[REUSE]") {
			hasReuse = true
		}
	}
	if !hasReuse {
		t.Errorf("expected structured log marker [REUSE]")
	}
}

func TestRequestDeviceCertificate_RateLimited(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_ = json.NewEncoder(w).Encode(provisionResponsePayload{
			Error:      "Daily quota exceeded for device",
			ReasonKey:  "rate_limited",
			RetryAfter: 86400,
		})
	}))
	defer server.Close()

	opts := ProvisionOptions{
		Endpoint: server.URL,
		NodeID:   "ratelimited12",
	}

	_, err := RequestDeviceCertificate(context.Background(), server.Client(), opts)
	if err == nil {
		t.Fatalf("expected rate limit error, got nil")
	}
	if !errors.Is(err, ErrRateLimited) {
		t.Errorf("expected error to wrap ErrRateLimited, got %v", err)
	}
	if !strings.Contains(err.Error(), "retry after 86400s") {
		t.Errorf("expected error to include retry after hint, got: %v", err)
	}
}

func TestRequestDeviceCertificate_MismatchedKey(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Intentionally sign certificate with a rogue/different public key
		roguePriv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		template := x509.Certificate{
			SerialNumber: big.NewInt(999),
			Subject:      pkix.Name{CommonName: "mismatch.direct.eqt.net.im"},
			NotBefore:    time.Now().Add(-1 * time.Hour),
			NotAfter:     time.Now().Add(90 * 24 * time.Hour),
		}
		certDER, _ := x509.CreateCertificate(rand.Reader, &template, &template, &roguePriv.PublicKey, roguePriv)
		certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(provisionResponsePayload{
			CertPEM: string(certPEM),
		})
	}))
	defer server.Close()

	opts := ProvisionOptions{
		Endpoint: server.URL,
		NodeID:   "mismatchnode1",
	}

	_, err := RequestDeviceCertificate(context.Background(), server.Client(), opts)
	if err == nil {
		t.Fatalf("expected ErrCertKeyMismatch, got nil error")
	}
	if !errors.Is(err, ErrCertKeyMismatch) {
		t.Errorf("expected error to wrap ErrCertKeyMismatch, got: %v", err)
	}
}

func TestRequestDeviceCertificate_GatewayError(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(provisionResponsePayload{
			Error:     "Internal database error",
			ReasonKey: "db_failure",
		})
	}))
	defer server.Close()

	opts := ProvisionOptions{
		Endpoint: server.URL,
		NodeID:   "servererror01",
	}

	_, err := RequestDeviceCertificate(context.Background(), server.Client(), opts)
	if err == nil {
		t.Fatalf("expected gateway error, got nil")
	}
	if !errors.Is(err, ErrGatewayFailed) {
		t.Errorf("expected error to wrap ErrGatewayFailed, got: %v", err)
	}
}
