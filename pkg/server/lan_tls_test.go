package server

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"eqt/pkg/cert"
	"eqt/pkg/config"
)

// generateTestCertificate generates an in-memory TLS certificate with SAN for testing.
func generateTestCertificate(san string) (certFile string, keyFile string, cleanup func(), err error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", nil, err
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			Organization: []string{"EQT Test Corp"},
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{san, "*.direct.eqt.net.im", "direct.eqt.net.im"},
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return "", "", nil, err
	}

	tmpDir, err := os.MkdirTemp("", "eqt-test-cert-*")
	if err != nil {
		return "", "", nil, err
	}

	certPath := filepath.Join(tmpDir, "fullchain.pem")
	certOut, err := os.Create(certPath)
	if err != nil {
		os.RemoveAll(tmpDir)
		return "", "", nil, err
	}
	_ = pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	_ = certOut.Close()

	keyPath := filepath.Join(tmpDir, "privkey.pem")
	keyOut, err := os.Create(keyPath)
	if err != nil {
		os.RemoveAll(tmpDir)
		return "", "", nil, err
	}
	b, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		os.RemoveAll(tmpDir)
		return "", "", nil, err
	}
	_ = pem.Encode(keyOut, &pem.Block{Type: "EC PRIVATE KEY", Bytes: b})
	_ = keyOut.Close()

	cleanup = func() {
		os.RemoveAll(tmpDir)
	}

	return certPath, keyPath, cleanup, nil
}

func TestLanTLSLoopbackServer(t *testing.T) {
	// Generate self-contained test cert so this test never fails on clean CI machines
	certPath, keyPath, cleanup, err := generateTestCertificate("127-0-0-1.direct.eqt.net.im")
	if err != nil {
		t.Fatalf("Failed to generate test certificate: %v", err)
	}
	defer cleanup()

	cfg := &config.Config{
		Bind:      "127.0.0.1",
		Port:      0, // random available port
		Secure:    true,
		Path:      "test-session",
		KeepAlive: true,
		TlsCert:   certPath,
		TlsKey:    keyPath,
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

	// Real TLS handshake test
	port := parsedURL.Port()
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			ServerName:         "127-0-0-1.direct.eqt.net.im",
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

	if resp.TLS.Version < tls.VersionTLS12 {
		t.Errorf("Expected TLS >= 1.2, got 0x%04x", resp.TLS.Version)
	}
}

func TestLanTLSLoopbackBindAny(t *testing.T) {
	// Test bind 0.0.0.0 with Secure: true, verifying it does not produce 0-0-0-0.direct
	certPath, keyPath, cleanup, err := generateTestCertificate("127-0-0-1.direct.eqt.net.im")
	if err != nil {
		t.Fatalf("Failed to generate test certificate: %v", err)
	}
	defer cleanup()

	cfg := &config.Config{
		Bind:      "0.0.0.0",
		Interface: "lo",
		Port:      0,
		Secure:    true,
		Path:      "test-any-session",
		KeepAlive: true,
		TlsCert:   certPath,
		TlsKey:    keyPath,
	}

	srv, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create server with bind 0.0.0.0: %v", err)
	}
	defer srv.Shutdown()

	parsedURL, err := url.Parse(srv.BaseURL)
	if err != nil {
		t.Fatalf("Failed to parse BaseURL %q: %v", srv.BaseURL, err)
	}

	if strings.HasPrefix(parsedURL.Host, "0-0-0-0") {
		t.Errorf("Hostname should not be 0-0-0-0, got %q", parsedURL.Host)
	}
	if parsedURL.Scheme != "https" {
		t.Errorf("Expected scheme https, got %q", parsedURL.Scheme)
	}
}

func TestLanTLSWithDedicatedNodeCertificate(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	nodeID := GetDeviceNodeID()
	if nodeID == "" {
		t.Fatalf("GetDeviceNodeID returned empty string")
	}

	// 1. Generate dedicated device private key
	priv, err := cert.LoadOrGenerateDeviceKey(nodeID)
	if err != nil {
		t.Fatalf("Failed to generate device key: %v", err)
	}

	// 2. Issue dedicated certificate matching this node ID using mock test CA
	caPriv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	caTemplate := x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Mock Test LAN-TLS CA"},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, &caTemplate, &caTemplate, &caPriv.PublicKey, caPriv)
	if err != nil {
		t.Fatalf("Failed to create CA: %v", err)
	}
	caCert, _ := x509.ParseCertificate(caDER)
	testPool := x509.NewCertPool()
	testPool.AddCert(caCert)
	cert.SetCustomRootPoolForTesting(testPool)
	defer cert.SetCustomRootPoolForTesting(nil)

	nodeDomain := cert.GetNodeDomain(nodeID)
	wildcardDomain := "*." + nodeDomain
	template := x509.Certificate{
		SerialNumber: big.NewInt(42),
		Subject: pkix.Name{
			CommonName:   nodeDomain,
			Organization: []string{"EQT Test Node"},
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(90 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{nodeDomain, wildcardDomain, "127-0-0-1." + nodeDomain},
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, &template, caCert, &priv.PublicKey, caPriv)
	if err != nil {
		t.Fatalf("Failed to create certificate: %v", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	certPEM = append(certPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})...)

	if err := cert.SaveDeviceCertificate(nodeID, certPEM); err != nil {
		t.Fatalf("Failed to save dedicated certificate: %v", err)
	}

	// 3. Start server with no explicit custom cert/key (auto-detect dedicated cert)
	cfg := &config.Config{
		Bind:      "127.0.0.1",
		Port:      0,
		Secure:    true,
		Path:      "test-dedicated-node",
		KeepAlive: true,
	}

	srv, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create server with dedicated node cert: %v", err)
	}
	defer srv.Shutdown()

	parsedURL, err := url.Parse(srv.BaseURL)
	if err != nil {
		t.Fatalf("Failed to parse BaseURL %q: %v", srv.BaseURL, err)
	}

	// 4. Verify BaseURL includes the dedicated nodeID subdomain
	expectedPrefix := fmt.Sprintf("127-0-0-1.%s.direct.eqt.net.im:", nodeID)
	if !strings.HasPrefix(parsedURL.Host, expectedPrefix) {
		t.Errorf("Expected Host to start with %q, got %q", expectedPrefix, parsedURL.Host)
	}
	if parsedURL.Scheme != "https" {
		t.Errorf("Expected scheme https, got %q", parsedURL.Scheme)
	}

	// 5. Verify actual HTTPS handshake against the loopback server
	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
		},
		Timeout: 3 * time.Second,
	}

	reqURL := fmt.Sprintf("https://127.0.0.1:%s/send/%s", parsedURL.Port(), cfg.Path)
	resp, err := client.Get(reqURL)
	if err != nil {
		t.Fatalf("TLS request to dedicated node server failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
	if resp.TLS == nil {
		t.Fatalf("Expected TLS connection, got nil")
	}
}
