package cert

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io/fs"
	"log"
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

	// Capture log output to lock warning assertions (falsifiable per Rule 9)
	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(os.Stderr)

	// 1. First generation: creates new key file
	priv1, err := LoadOrGenerateDeviceKey(nodeID)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	if priv1 == nil || priv1.Curve != elliptic.P256() {
		t.Fatalf("expected valid P-256 private key")
	}
	if !strings.Contains(logBuf.String(), "[INFO] Private key at") {
		t.Errorf("expected initial setup log to contain '[INFO] Private key at', got: %s", logBuf.String())
	}
	logBuf.Reset()

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

	// 3. Corrupted key recovery: overwriting with invalid PEM triggers regeneration with warning
	if err := os.WriteFile(keyPath, []byte("-----BEGIN EC PRIVATE KEY-----\nINVALID CORRUPTED\n-----END EC PRIVATE KEY-----"), 0600); err != nil {
		t.Fatalf("failed to write corrupted key: %v", err)
	}
	priv3, err := LoadOrGenerateDeviceKey(nodeID)
	if err != nil {
		t.Fatalf("failed to regenerate key after corruption: %v", err)
	}
	if priv3 == nil || priv1.PublicKey.Equal(&priv3.PublicKey) {
		t.Fatalf("expected new key pair to be generated when existing key file is corrupted")
	}
	if !strings.Contains(logBuf.String(), "[WARNING] Existing private key at") {
		t.Errorf("expected warning in log for corrupted key, got: %s", logBuf.String())
	}
	logBuf.Reset()

	// 4. Missing key when fullchain exists (F12 root cause: cache cleaned or key lost)
	certPath := filepath.Join(tempHome, ".config", "eqt", "certs", nodeID, "fullchain.pem")
	if err := os.WriteFile(certPath, []byte("EXISTING_CERT_PLACEHOLDER"), 0644); err != nil {
		t.Fatalf("failed to write dummy fullchain.pem: %v", err)
	}
	if err := os.Remove(keyPath); err != nil {
		t.Fatalf("failed to remove key file: %v", err)
	}
	priv4, err := LoadOrGenerateDeviceKey(nodeID)
	if err != nil {
		t.Fatalf("failed to regenerate key when key is missing: %v", err)
	}
	if priv4 == nil {
		t.Fatalf("expected valid regenerated key")
	}
	if !strings.Contains(logBuf.String(), "[WARNING] Private key at") || !strings.Contains(logBuf.String(), "is missing while fullchain.pem exists") {
		t.Errorf("expected warning in log for missing key when certificate exists, got: %s", logBuf.String())
	}
	logBuf.Reset()

	// 5. Read error (non-NotExist error: permission denied triggers WARNING)
	t.Run("PermissionDenied_UnreadableKey", func(t *testing.T) {
		if err := os.Chmod(keyPath, 0000); err != nil {
			t.Skipf("skipping: chmod 0000 not supported in current environment: %v", err)
		}
		defer os.Chmod(keyPath, 0600)
		_, testReadErr := os.ReadFile(keyPath)
		if testReadErr == nil {
			// Read succeeded despite chmod 0000 (e.g. running as root / CAP_DAC_OVERRIDE / Windows filesystem ACLs)
			_ = os.Chmod(keyPath, 0600)
			t.Skip("skipping unreadable key test: running as root or filesystem does not enforce POSIX 0000 permissions")
		}
		if !errors.Is(testReadErr, fs.ErrPermission) && !os.IsPermission(testReadErr) {
			t.Skipf("skipping: unexpected read error type (not fs.ErrPermission): %v", testReadErr)
		}
		priv5, err := LoadOrGenerateDeviceKey(nodeID)
		_ = os.Chmod(keyPath, 0600) // Restore for teardown
		if err != nil {
			t.Fatalf("unexpected failure on unreadable key: %v", err)
		}
		if priv5 == nil {
			t.Fatalf("expected valid key to be generated")
		}
		if !strings.Contains(logBuf.String(), "[WARNING] Failed to read private key at") {
			t.Errorf("expected warning in log for read error, got: %s", logBuf.String())
		}
	})
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

	// Setup mock test CA
	caPriv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	caTemplate := x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test LAN-TLS Root CA"},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, &caTemplate, &caTemplate, &caPriv.PublicKey, caPriv)
	if err != nil {
		t.Fatalf("failed to create CA: %v", err)
	}
	caCert, _ := x509.ParseCertificate(caDER)
	testPool := x509.NewCertPool()
	testPool.AddCert(caCert)

	// 1. Create a leaf certificate matching this private key signed by caPriv
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
	certDER, err := x509.CreateCertificate(rand.Reader, &template, caCert, &priv.PublicKey, caPriv)
	if err != nil {
		t.Fatalf("failed to create test certificate: %v", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	certPEM = append(certPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})...)

	// 2. Without testPool in CustomRootPoolForTesting, SaveDeviceCertificate MUST reject untrusted certificate (FINDING 4)
	SetCustomRootPoolForTesting(nil)
	if err := SaveDeviceCertificate(nodeID, certPEM); err == nil {
		t.Fatalf("expected SaveDeviceCertificate to reject untrusted certificate when not in root store")
	}

	// 3. Now configure testPool as trusted roots for the test
	SetCustomRootPoolForTesting(testPool)
	defer SetCustomRootPoolForTesting(nil)

	// 4. Try to save certificate using a mismatched private key (must fail)
	otherPriv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	mismatchDER, _ := x509.CreateCertificate(rand.Reader, &template, caCert, &otherPriv.PublicKey, caPriv)
	mismatchPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: mismatchDER})
	mismatchPEM = append(mismatchPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})...)

	if err := SaveDeviceCertificate(nodeID, mismatchPEM); err == nil {
		t.Fatalf("expected SaveDeviceCertificate to reject mismatched key, got nil error")
	}

	// 5. Save matching certificate (must succeed now that root is trusted)
	if err := SaveDeviceCertificate(nodeID, certPEM); err != nil {
		t.Fatalf("failed to save matching certificate: %v", err)
	}

	// 6. Verify HasValidDeviceCertificate
	if !HasValidDeviceCertificate(nodeID) {
		t.Errorf("expected HasValidDeviceCertificate to return true")
	}

	// 7. Load certificate and verify SANs
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

	// 8. Test GetActiveCertificate resolution order
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

	// Setup mock root CA for test gateway
	mockCAPriv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	mockCATemplate := x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Mock Gateway Root CA"},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	mockCADER, err := x509.CreateCertificate(rand.Reader, &mockCATemplate, &mockCATemplate, &mockCAPriv.PublicKey, mockCAPriv)
	if err != nil {
		t.Fatalf("failed to create mock CA: %v", err)
	}
	mockCACert, _ := x509.ParseCertificate(mockCADER)
	mockPool := x509.NewCertPool()
	mockPool.AddCert(mockCACert)
	SetCustomRootPoolForTesting(mockPool)
	defer SetCustomRootPoolForTesting(nil)

	// Set up mock Gateway server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++

		if r.Method != http.MethodPost {
			t.Errorf("unexpected method: %s", r.Method)
		}
		if r.Header.Get("X-EQT-Device-ID") != "dev_test_id" {
			t.Errorf("unexpected device ID: %s", r.Header.Get("X-EQT-Device-ID"))
		}
		if r.Header.Get("X-EQT-Hardware-Signature") == "" {
			t.Errorf("missing X-EQT-Hardware-Signature header")
		}
		if r.Header.Get("X-EQT-Device-Signature") != r.Header.Get("X-EQT-Hardware-Signature") {
			t.Errorf("expected Device-Signature and Hardware-Signature to match")
		}

		if r.Header.Get("X-EQT-Device-Signature") == "" {
			t.Errorf("missing X-EQT-Device-Signature header")
		}
		if r.Header.Get("X-EQT-Timestamp") == "" {
			t.Errorf("missing X-EQT-Timestamp header")
		}

		var payload provisionRequestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("invalid json body: %v", err)
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

		// Verify Proof of Possession using client's public key from CSR
		pubKey, ok := csr.PublicKey.(*ecdsa.PublicKey)
		if !ok {
			t.Fatalf("expected ECDSA public key in CSR")
		}
		sigHeader := r.Header.Get("X-EQT-Device-Signature")
		tsHeader := r.Header.Get("X-EQT-Timestamp")
		var tsVal int64
		_, _ = fmt.Sscanf(tsHeader, "%d", &tsVal)
		if !VerifyProvisionPayload(pubKey, payload.NodeID, tsVal, sigHeader) {
			t.Errorf("POPO signature verification failed in mock server")
		}

		// Issue cert signed by mock CA
		template := x509.Certificate{
			SerialNumber: big.NewInt(777),
			Subject:      csr.Subject,
			NotBefore:    time.Now().Add(-1 * time.Hour),
			NotAfter:     time.Now().Add(90 * 24 * time.Hour),
			DNSNames:     csr.DNSNames,
		}
		certDER, err := x509.CreateCertificate(rand.Reader, &template, mockCACert, csr.PublicKey, mockCAPriv)
		if err != nil {
			t.Fatalf("failed to create certificate: %v", err)
		}
		certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
		certPEM = append(certPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: mockCADER})...)

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
		Endpoint: server.URL,
		NodeID:   nodeID,
		DeviceID: "dev_test_id",
		Timeout:  5 * time.Second,
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

func TestRequestDeviceCertificate_NodeKeyMismatch(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(provisionResponsePayload{
			Error:     "node public key mismatch with cloud registered key",
			ReasonKey: "node_key_mismatch",
		})
	}))
	defer server.Close()

	opts := ProvisionOptions{
		Endpoint: server.URL,
		NodeID:   "mismatchnode01",
	}

	_, err := RequestDeviceCertificate(context.Background(), server.Client(), opts)
	if err == nil {
		t.Fatalf("expected ErrNodeKeyMismatch, got nil")
	}
	if !errors.Is(err, ErrNodeKeyMismatch) {
		t.Errorf("expected error to wrap ErrNodeKeyMismatch, got: %v", err)
	}
}

func TestSignAndVerifyProvisionPayload(t *testing.T) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate P-256 key: %v", err)
	}

	nodeID := "a1b2c3d4e5f6"
	timestamp := time.Now().Unix()

	// 1. Successful sign & verify
	sigB64, err := SignProvisionPayload(priv, nodeID, timestamp)
	if err != nil {
		t.Fatalf("SignProvisionPayload failed: %v", err)
	}
	if sigB64 == "" {
		t.Fatalf("expected non-empty signature string")
	}

	if !VerifyProvisionPayload(&priv.PublicKey, nodeID, timestamp, sigB64) {
		t.Errorf("expected signature verification to pass")
	}

	// 2. Tampered nodeID fails
	if VerifyProvisionPayload(&priv.PublicKey, "differentnode", timestamp, sigB64) {
		t.Errorf("expected verification to fail for tampered nodeID")
	}

	// 3. Tampered timestamp fails
	if VerifyProvisionPayload(&priv.PublicKey, nodeID, timestamp+1, sigB64) {
		t.Errorf("expected verification to fail for tampered timestamp")
	}

	// 4. Different public key fails
	otherPriv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if VerifyProvisionPayload(&otherPriv.PublicKey, nodeID, timestamp, sigB64) {
		t.Errorf("expected verification to fail for different public key")
	}

	// 5. Invalid arguments to SignProvisionPayload
	if _, err := SignProvisionPayload(nil, nodeID, timestamp); err == nil {
		t.Errorf("expected error for nil private key")
	}
	if _, err := SignProvisionPayload(priv, "", timestamp); err == nil {
		t.Errorf("expected error for empty nodeID")
	}
	if _, err := SignProvisionPayload(priv, nodeID, 0); err == nil {
		t.Errorf("expected error for zero timestamp")
	}
}

func TestUntrustedDeviceCertificate_FailSoft(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	nodeID := "nodefailsoft00"
	priv, err := LoadOrGenerateDeviceKey(nodeID)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	// Create an untrusted self-signed certificate (typical of standalone CA / fallback)
	template := x509.Certificate{
		SerialNumber: big.NewInt(9999),
		Subject: pkix.Name{
			CommonName: "nodefailsoft00.direct.eqt.net.im",
		},
		NotBefore: time.Now().Add(-1 * time.Hour),
		NotAfter:  time.Now().Add(90 * 24 * time.Hour),
		DNSNames: []string{
			"nodefailsoft00.direct.eqt.net.im",
			"*.nodefailsoft00.direct.eqt.net.im",
		},
		BasicConstraintsValid: true,
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("failed to create certificate: %v", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})

	// 1. SaveDeviceCertificate MUST reject untrusted certificate
	SetCustomRootPoolForTesting(nil)
	if err := SaveDeviceCertificate(nodeID, certPEM); err == nil {
		t.Fatalf("expected SaveDeviceCertificate to reject untrusted cert, got nil error")
	} else if !errors.Is(err, ErrUntrustedCertificate) {
		t.Errorf("expected ErrUntrustedCertificate, got: %v", err)
	}

	// 2. Even if an untrusted certificate was manually placed on disk, GetDeviceCertificate must reject it
	dir, err := GetDeviceCertDir(nodeID)
	if err != nil {
		t.Fatalf("failed to get cert dir: %v", err)
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatalf("failed to mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "fullchain.pem"), certPEM, 0644); err != nil {
		t.Fatalf("failed to write untrusted fullchain.pem: %v", err)
	}

	// 3. Verify GetDeviceCertificate rejects untrusted certificate
	if _, err := GetDeviceCertificate(nodeID); err == nil {
		t.Fatalf("expected GetDeviceCertificate to reject untrusted cert from disk")
	}

	// 4. Verify HasValidDeviceCertificate and HasValidCertificateForNode return false
	if HasValidDeviceCertificate(nodeID) {
		t.Errorf("expected HasValidDeviceCertificate to return false for untrusted cert")
	}
	if HasValidCertificateForNode("", "", nodeID) {
		t.Errorf("expected HasValidCertificateForNode to return false for untrusted cert")
	}

	// 5. Test legacy wildcard cache path: manually place untrusted cert in ~/.config/eqt/certs
	// Note: getCachedCertPaths strictly looks for "fullchain.pem" and "privkey.pem"
	legacyDir := filepath.Join(tempHome, ".config", "eqt", "certs")
	if err := os.MkdirAll(legacyDir, 0700); err != nil {
		t.Fatalf("failed to mkdir legacy certs: %v", err)
	}
	keyDER, _ := x509.MarshalECPrivateKey(priv)
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	if err := os.WriteFile(filepath.Join(legacyDir, "fullchain.pem"), certPEM, 0644); err != nil {
		t.Fatalf("failed to write legacy fullchain.pem: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyDir, "privkey.pem"), keyPEM, 0600); err != nil {
		t.Fatalf("failed to write legacy privkey.pem: %v", err)
	}

	// 5a. Verify legacy wildcard path REJECTS untrusted certificate (Falsifiability Part 1)
	SetCustomRootPoolForTesting(nil)
	if _, _, err := GetActiveCertificate("", "", ""); err == nil {
		t.Errorf("expected GetActiveCertificate to reject untrusted legacy wildcard cert")
	}
	if HasValidCertificate("", "") {
		t.Errorf("expected HasValidCertificate to return false for untrusted legacy wildcard cert")
	}

	// 5b. Verify legacy wildcard path ACCEPTS certificate once root is trusted (Falsifiability Part 2)
	parsedCert, err := x509.ParseCertificate(certDER)
	if err != nil {
		t.Fatalf("failed to parse cert DER: %v", err)
	}
	trustedPool := x509.NewCertPool()
	trustedPool.AddCert(parsedCert)
	SetCustomRootPoolForTesting(trustedPool)
	defer SetCustomRootPoolForTesting(nil)

	if _, _, err := GetActiveCertificate("", "", ""); err != nil {
		t.Errorf("expected GetActiveCertificate to accept trusted legacy wildcard cert, got: %v", err)
	}
	if !HasValidCertificate("", "") {
		t.Errorf("expected HasValidCertificate to return true for trusted legacy wildcard cert")
	}
}

func TestGetDeviceCertDir_LegacyFallbackAndMigration(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	nodeID := "legacynode99"
	legacyDir := filepath.Join(tempHome, ".config", "eqt", "certs", nodeID)
	if err := os.MkdirAll(legacyDir, 0700); err != nil {
		t.Fatal(err)
	}
	legacyKey := filepath.Join(legacyDir, "privkey.pem")
	if err := os.WriteFile(legacyKey, []byte("legacy-p256-key-data"), 0600); err != nil {
		t.Fatal(err)
	}

	// Set unified target config dir
	targetConfigDir := filepath.Join(tempHome, "appdata", "eqt")
	t.Setenv("EQT_CONFIG_DIR", targetConfigDir)

	// Call GetDeviceCertDir
	dir, err := GetDeviceCertDir(nodeID)
	if err != nil {
		t.Fatalf("GetDeviceCertDir failed: %v", err)
	}

	expectedTargetDir := filepath.Join(targetConfigDir, "certs", nodeID)
	if dir != expectedTargetDir {
		t.Fatalf("GetDeviceCertDir = %q, want %q", dir, expectedTargetDir)
	}

	// Verify the private key was migrated to expectedTargetDir with 0600 permissions
	migratedKey := filepath.Join(expectedTargetDir, "privkey.pem")
	data, err := os.ReadFile(migratedKey)
	if err != nil {
		t.Fatalf("expected migrated key at %s, got error: %v", migratedKey, err)
	}
	if string(data) != "legacy-p256-key-data" {
		t.Fatalf("migrated key content mismatch, got: %s", string(data))
	}
	fi, err := os.Stat(migratedKey)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0600 {
		t.Fatalf("expected 0600 permissions on migrated key, got: %o", fi.Mode().Perm())
	}
}
