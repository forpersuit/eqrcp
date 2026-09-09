package cert

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// GetNodeDomain returns the canonical apex domain for the given node ID.
// e.g. "a1b2c3d4e5f6" -> "a1b2c3d4e5f6.direct.eqt.net.im"
func GetNodeDomain(nodeID string) string {
	clean := strings.ToLower(strings.TrimSpace(nodeID))
	if clean == "" {
		return BaseDomain
	}
	return fmt.Sprintf("%s.%s", clean, BaseDomain)
}

// FormatDirectDomainWithNode converts an IPv4 address to its corresponding loopback domain,
// taking into account the optional device node ID.
// e.g. ("192.168.0.201", "a1b2c3d4e5f6") -> "192-168-0-201.a1b2c3d4e5f6.direct.eqt.net.im"
// If nodeID is empty, it falls back to FormatDirectDomain ("192-168-0-201.direct.eqt.net.im").
func FormatDirectDomainWithNode(ipStr string, nodeID string) string {
	cleanIP := strings.TrimSpace(ipStr)
	parsed := net.ParseIP(cleanIP)
	if parsed == nil {
		return ipStr
	}
	ipv4 := parsed.To4()
	if ipv4 == nil {
		return ipStr
	}
	dashed := fmt.Sprintf("%d-%d-%d-%d", ipv4[0], ipv4[1], ipv4[2], ipv4[3])
	cleanNode := strings.ToLower(strings.TrimSpace(nodeID))
	if cleanNode == "" {
		return fmt.Sprintf("%s.%s", dashed, BaseDomain)
	}
	return fmt.Sprintf("%s.%s.%s", dashed, cleanNode, BaseDomain)
}

// GetDeviceCertDir returns the directory path where certificate and private key
// for the given node ID are stored (~/.config/eqt/certs/<node-id>).
func GetDeviceCertDir(nodeID string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user home directory: %w", err)
	}
	cleanNode := strings.ToLower(strings.TrimSpace(nodeID))
	if cleanNode == "" {
		return filepath.Join(home, ".config", "eqt", "certs"), nil
	}
	return filepath.Join(home, ".config", "eqt", "certs", cleanNode), nil
}

// LoadOrGenerateDeviceKey loads the ECDSA P-256 private key for nodeID from disk,
// or generates a new one securely in local memory and saves it with restricted 0600 permissions.
// The private key is strictly isolated and never transmitted across the network.
func LoadOrGenerateDeviceKey(nodeID string) (*ecdsa.PrivateKey, error) {
	dir, err := GetDeviceCertDir(nodeID)
	if err != nil {
		return nil, err
	}
	keyPath := filepath.Join(dir, "privkey.pem")

	// 1. Try to load existing private key
	if data, err := os.ReadFile(keyPath); err == nil {
		block, _ := pem.Decode(data)
		if block != nil {
			if key, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
				return key, nil
			}
			if keyIface, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
				if ecKey, ok := keyIface.(*ecdsa.PrivateKey); ok {
					return ecKey, nil
				}
			}
		}
	}

	// 2. Generate a new ECDSA P-256 private key
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate ECDSA P-256 key: %w", err)
	}

	derBytes, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal EC private key: %w", err)
	}

	pemBlock := pem.EncodeToMemory(&pem.Block{
		Type:  "EC PRIVATE KEY",
		Bytes: derBytes,
	})

	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create certificate directory: %w", err)
	}

	// Write atomically with 0600 permissions
	tmpFile := keyPath + ".tmp"
	if err := os.WriteFile(tmpFile, pemBlock, 0600); err != nil {
		return nil, fmt.Errorf("failed to write private key: %w", err)
	}
	if err := os.Rename(tmpFile, keyPath); err != nil {
		_ = os.Remove(tmpFile)
		return nil, fmt.Errorf("failed to commit private key: %w", err)
	}

	return priv, nil
}

// GenerateDeviceCSR creates a PKCS#10 Certificate Signing Request (CSR) in PEM format
// for the given node ID using the specified private key.
// The CSR contains SAN entries for both <node-id>.direct.eqt.net.im and *.<node-id>.direct.eqt.net.im.
func GenerateDeviceCSR(priv *ecdsa.PrivateKey, nodeID string) ([]byte, error) {
	if priv == nil {
		return nil, errors.New("private key cannot be nil")
	}
	cleanNode := strings.ToLower(strings.TrimSpace(nodeID))
	if cleanNode == "" {
		return nil, errors.New("node ID cannot be empty")
	}

	nodeDomain := fmt.Sprintf("%s.%s", cleanNode, BaseDomain)
	wildcardDomain := fmt.Sprintf("*.%s.%s", cleanNode, BaseDomain)

	subj := pkix.Name{
		CommonName:   nodeDomain,
		Organization: []string{"EQT LAN-TLS"},
	}

	template := x509.CertificateRequest{
		Subject:            subj,
		SignatureAlgorithm: x509.ECDSAWithSHA256,
		DNSNames:           []string{nodeDomain, wildcardDomain},
	}

	csrDER, err := x509.CreateCertificateRequest(rand.Reader, &template, priv)
	if err != nil {
		return nil, fmt.Errorf("failed to create certificate request: %w", err)
	}

	csrPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE REQUEST",
		Bytes: csrDER,
	})

	return csrPEM, nil
}

// SignProvisionPayload generates an IEEE P1363 ECDSA P-256 signature (64 bytes raw: 32-byte r || 32-byte s, Base64-encoded)
// over the canonical message "<nodeID>:<timestamp>", serving as a cryptographic proof-of-possession (POPO).
func SignProvisionPayload(priv *ecdsa.PrivateKey, nodeID string, timestamp int64) (string, error) {
	if priv == nil {
		return "", errors.New("private key cannot be nil")
	}
	cleanNode := strings.ToLower(strings.TrimSpace(nodeID))
	if cleanNode == "" {
		return "", errors.New("node ID cannot be empty")
	}
	if timestamp <= 0 {
		return "", errors.New("timestamp must be positive")
	}

	msg := fmt.Sprintf("%s:%d", cleanNode, timestamp)
	hash := sha256.Sum256([]byte(msg))
	r, s, err := ecdsa.Sign(rand.Reader, priv, hash[:])
	if err != nil {
		return "", fmt.Errorf("ecdsa sign failed: %w", err)
	}

	rBytes := r.Bytes()
	sBytes := s.Bytes()
	if len(rBytes) > 32 || len(sBytes) > 32 {
		return "", errors.New("invalid signature component length for P-256")
	}

	rawSig := make([]byte, 64)
	copy(rawSig[32-len(rBytes):32], rBytes)
	copy(rawSig[64-len(sBytes):64], sBytes)

	return base64.StdEncoding.EncodeToString(rawSig), nil
}

// VerifyProvisionPayload verifies an IEEE P1363 ECDSA P-256 signature against nodeID, timestamp, and public key.
func VerifyProvisionPayload(pub *ecdsa.PublicKey, nodeID string, timestamp int64, sigB64 string) bool {
	if pub == nil {
		return false
	}
	cleanNode := strings.ToLower(strings.TrimSpace(nodeID))
	if cleanNode == "" || timestamp <= 0 || sigB64 == "" {
		return false
	}
	rawSig, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil || len(rawSig) != 64 {
		return false
	}
	r := new(big.Int).SetBytes(rawSig[:32])
	s := new(big.Int).SetBytes(rawSig[32:])

	msg := fmt.Sprintf("%s:%d", cleanNode, timestamp)
	hash := sha256.Sum256([]byte(msg))
	return ecdsa.Verify(pub, hash[:], r, s)
}

// VerifyCertificateMatchesPrivateKey checks whether the public key in the given x509 certificate
// matches the public key of the provided ECDSA private key.
func VerifyCertificateMatchesPrivateKey(cert *x509.Certificate, priv *ecdsa.PrivateKey) bool {
	if cert == nil || priv == nil {
		return false
	}
	pubKey, ok := cert.PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return false
	}
	return pubKey.Equal(&priv.PublicKey)
}

// SaveDeviceCertificate verifies and saves the full certificate chain (PEM) for nodeID.
// It ensures that the leaf certificate matches the local private key before writing to disk.
func SaveDeviceCertificate(nodeID string, certPEM []byte) error {
	cleanNode := strings.ToLower(strings.TrimSpace(nodeID))
	if cleanNode == "" {
		return errors.New("node ID cannot be empty")
	}

	// 1. Decode and parse the first certificate in the chain
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return errors.New("invalid PEM data: no certificate block found")
	}
	leafCert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return fmt.Errorf("failed to parse leaf certificate: %w", err)
	}

	// 2. Load private key to verify cryptographic match
	priv, err := LoadOrGenerateDeviceKey(cleanNode)
	if err != nil {
		return fmt.Errorf("failed to load device private key: %w", err)
	}

	if !VerifyCertificateMatchesPrivateKey(leafCert, priv) {
		return errors.New("certificate public key does not match local device private key")
	}

	// 3. Atomically save fullchain.pem
	dir, err := GetDeviceCertDir(cleanNode)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create cert directory: %w", err)
	}

	certPath := filepath.Join(dir, "fullchain.pem")
	tmpFile := certPath + ".tmp"
	if err := os.WriteFile(tmpFile, certPEM, 0644); err != nil {
		return fmt.Errorf("failed to write certificate chain: %w", err)
	}
	if err := os.Rename(tmpFile, certPath); err != nil {
		_ = os.Remove(tmpFile)
		return fmt.Errorf("failed to commit certificate chain: %w", err)
	}

	return nil
}

// GetDeviceCertificate loads the unexpired TLS certificate for nodeID from disk.
// Returns an error if the certificate does not exist, is expired, or fails verification.
func GetDeviceCertificate(nodeID string) (tls.Certificate, error) {
	cleanNode := strings.ToLower(strings.TrimSpace(nodeID))
	if cleanNode == "" {
		return tls.Certificate{}, errors.New("node ID cannot be empty")
	}

	dir, err := GetDeviceCertDir(cleanNode)
	if err != nil {
		return tls.Certificate{}, err
	}

	certPath := filepath.Join(dir, "fullchain.pem")
	keyPath := filepath.Join(dir, "privkey.pem")

	if _, err := os.Stat(certPath); err != nil {
		return tls.Certificate{}, fmt.Errorf("device certificate not found: %w", err)
	}
	if _, err := os.Stat(keyPath); err != nil {
		return tls.Certificate{}, fmt.Errorf("device private key not found: %w", err)
	}

	tlsCert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("failed to load device keypair: %w", err)
	}

	if isCertExpired(tlsCert) {
		return tls.Certificate{}, errors.New("device certificate is expired")
	}

	return tlsCert, nil
}

// HasValidDeviceCertificate returns true if a valid, unexpired device certificate exists for nodeID.
func HasValidDeviceCertificate(nodeID string) bool {
	_, err := GetDeviceCertificate(nodeID)
	return err == nil
}

// GetActiveCertificate resolves the active TLS certificate with the following priority:
// 1. Explicit customCert and customKey flags (if both provided);
// 2. Device-specific certificate for nodeID (if valid and unexpired);
// 3. Legacy wildcard certificate in ~/.config/eqt/certs (if valid and unexpired).
// Returns the tls.Certificate, the resolved active nodeID (empty string for legacy wildcard), and any error.
func GetActiveCertificate(customCert, customKey, nodeID string) (tls.Certificate, string, error) {
	// 1. Explicit custom paths
	if customCert != "" && customKey != "" {
		cert, err := tls.LoadX509KeyPair(customCert, customKey)
		return cert, "", err
	}

	// 2. Dedicated device certificate
	if cleanNode := strings.ToLower(strings.TrimSpace(nodeID)); cleanNode != "" {
		if devCert, err := GetDeviceCertificate(cleanNode); err == nil {
			return devCert, cleanNode, nil
		}
	}

	// 3. Legacy wildcard fallback
	if cacheCert, cacheKey, ok := getCachedCertPaths(); ok {
		if cert, err := tls.LoadX509KeyPair(cacheCert, cacheKey); err == nil {
			if !isCertExpired(cert) {
				return cert, "", nil
			}
		}
	}

	return tls.Certificate{}, "", fmt.Errorf("no valid TLS certificate available (device nodeID: %q)", nodeID)
}

const (
	// DefaultProvisionEndpoint is the production Cloudflare Gateway endpoint for certificate provisioning.
	DefaultProvisionEndpoint = "https://lic.eqt.net.im/api/v1/cert/provision"
)

var (
	ErrInvalidCSR      = errors.New("invalid certificate signing request")
	ErrRateLimited     = errors.New("certificate issuance rate limit exceeded")
	ErrGatewayFailed   = errors.New("remote certification gateway request failed")
	ErrCertKeyMismatch = errors.New("certificate public key does not match local device private key")
)

// ProvisionOptions configures the client parameters for provisioning a device certificate.
type ProvisionOptions struct {
	Endpoint  string                           // Target Gateway URL (defaults to DefaultProvisionEndpoint if empty)
	NodeID    string                           // Deterministic 12-char hex node ID
	DeviceID  string                           // DRM Authority Device ID
	Signature string                           // Base64-encoded hardware signature
	Timestamp int64                            // Unix timestamp in seconds
	Timeout   time.Duration                    // Request timeout (defaults to 30s if <= 0)
	LogFunc   func(format string, args ...any) // Optional structured logger callback
}

// ProvisionResult represents the outcome of a device certificate provisioning operation.
type ProvisionResult struct {
	Certificate tls.Certificate
	NodeID      string
	ExpiresAt   time.Time
	IsNew       bool
}

type provisionRequestPayload struct {
	CSRPEM string `json:"csr_pem"`
	NodeID string `json:"node_id"`
}

type provisionResponsePayload struct {
	CertPEM    string `json:"cert_pem,omitempty"`
	ExpiresAt  string `json:"expires_at,omitempty"`
	Error      string `json:"error,omitempty"`
	ReasonKey  string `json:"reason_key,omitempty"`
	RetryAfter int    `json:"retry_after,omitempty"`
}

// RequestDeviceCertificate orchestrates the local P-256 key generation, CSR construction,
// remote Gateway communication, and cryptographic verification/storage of the leaf certificate.
// It provides comprehensive structured logging and strict error classification.
func RequestDeviceCertificate(ctx context.Context, client *http.Client, opts ProvisionOptions) (*ProvisionResult, error) {
	startTime := time.Now()
	cleanNode := strings.ToLower(strings.TrimSpace(opts.NodeID))
	if cleanNode == "" {
		return nil, errors.New("node ID cannot be empty")
	}

	logger := opts.LogFunc
	if logger == nil {
		logger = func(format string, args ...any) {
			log.Printf(format, args...)
		}
	}

	endpoint := opts.Endpoint
	if endpoint == "" {
		if envEp := os.Getenv("EQT_PROVISION_ENDPOINT"); envEp != "" {
			endpoint = envEp
		} else {
			endpoint = DefaultProvisionEndpoint
		}
	}

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}

	logger("[LAN-TLS-PROVISION] [START] Initiating certificate provisioning for nodeID=%s, endpoint=%s", cleanNode, endpoint)

	// Step 1: Check existing certificate validity to avoid unnecessary issuance
	if devCert, err := GetDeviceCertificate(cleanNode); err == nil {
		if expiry, err := GetCertificateExpiry(devCert); err == nil {
			// If remaining validity > 15 days, reuse existing certificate
			if time.Until(expiry) > 15*24*time.Hour {
				logger("[LAN-TLS-PROVISION] [REUSE] Existing valid certificate found for nodeID=%s, expiresAt=%s (remaining=%s)",
					cleanNode, expiry.Format(time.RFC3339), time.Until(expiry).Round(time.Minute))
				return &ProvisionResult{
					Certificate: devCert,
					NodeID:      cleanNode,
					ExpiresAt:   expiry,
					IsNew:       false,
				}, nil
			}
			logger("[LAN-TLS-PROVISION] [RENEW] Certificate near expiration for nodeID=%s, expiresAt=%s (remaining=%s). Renewing...",
				cleanNode, expiry.Format(time.RFC3339), time.Until(expiry).Round(time.Minute))
		}
	}

	// Step 2: Load or generate local private key (Private key never leaves the device)
	keyStart := time.Now()
	priv, err := LoadOrGenerateDeviceKey(cleanNode)
	if err != nil {
		logger("[LAN-TLS-PROVISION] [ERROR] Phase=KEY_INIT nodeID=%s error=%v", cleanNode, err)
		return nil, fmt.Errorf("failed to initialize device private key: %w", err)
	}
	logger("[LAN-TLS-PROVISION] [KEY-INIT] Private key ready for nodeID=%s in %s (strictly offline, zero-leak)", cleanNode, time.Since(keyStart))

	// Step 3: Construct PKCS#10 Certificate Signing Request (CSR)
	csrStart := time.Now()
	csrPEM, err := GenerateDeviceCSR(priv, cleanNode)
	if err != nil {
		logger("[LAN-TLS-PROVISION] [ERROR] Phase=CSR_GEN nodeID=%s error=%v", cleanNode, err)
		return nil, fmt.Errorf("failed to generate device CSR: %w", err)
	}
	logger("[LAN-TLS-PROVISION] [CSR-GEN] Self-signed CSR constructed for nodeID=%s in %s (domains: %s, *.%s)",
		cleanNode, time.Since(csrStart), GetNodeDomain(cleanNode), GetNodeDomain(cleanNode))

	// Step 4: Dispatch HTTP request to Cloudflare Gateway
	reqBody, err := json.Marshal(provisionRequestPayload{
		CSRPEM: string(csrPEM),
		NodeID: cleanNode,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request payload: %w", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to build http request: %w", err)
	}

	// Compute anti-replay timestamp and proof-of-possession signature
	ts := opts.Timestamp
	if ts <= 0 {
		ts = time.Now().Unix()
	}
	sig := opts.Signature
	if sig == "" {
		var err error
		sig, err = SignProvisionPayload(priv, cleanNode, ts)
		if err != nil {
			logger("[LAN-TLS-PROVISION] [ERROR] Phase=SIGN_PAYLOAD nodeID=%s error=%v", cleanNode, err)
			return nil, fmt.Errorf("failed to sign provision payload: %w", err)
		}
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("User-Agent", "EQT-Provisioner/1.0")
	if opts.DeviceID != "" {
		httpReq.Header.Set("X-EQT-Device-ID", opts.DeviceID)
	}
	httpReq.Header.Set("X-EQT-Device-Signature", sig)
	httpReq.Header.Set("X-EQT-Hardware-Signature", sig)
	httpReq.Header.Set("X-EQT-Timestamp", fmt.Sprintf("%d", ts))

	httpClient := client
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	reqStart := time.Now()
	logger("[LAN-TLS-PROVISION] [GATEWAY-REQ] Sending CSR to %s for nodeID=%s...", endpoint, cleanNode)
	resp, err := httpClient.Do(httpReq)
	if err != nil {
		logger("[LAN-TLS-PROVISION] [ERROR] Phase=GATEWAY_NETWORK nodeID=%s error=%v", cleanNode, err)
		return nil, fmt.Errorf("%w: network transport error: %v", ErrGatewayFailed, err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read gateway response: %w", err)
	}

	logger("[LAN-TLS-PROVISION] [GATEWAY-RESP] Gateway returned HTTP %d in %s (bytes=%d)",
		resp.StatusCode, time.Since(reqStart), len(respBytes))

	var respPayload provisionResponsePayload
	_ = json.Unmarshal(respBytes, &respPayload)

	if resp.StatusCode != http.StatusOK {
		logger("[LAN-TLS-PROVISION] [ERROR] Phase=GATEWAY_HTTP_STATUS status=%d nodeID=%s reason=%s error=%s",
			resp.StatusCode, cleanNode, respPayload.ReasonKey, respPayload.Error)
		if resp.StatusCode == http.StatusTooManyRequests {
			return nil, fmt.Errorf("%w: %s (retry after %ds)", ErrRateLimited, respPayload.Error, respPayload.RetryAfter)
		}
		if resp.StatusCode == http.StatusBadRequest && respPayload.ReasonKey == "invalid_csr" {
			return nil, fmt.Errorf("%w: %s", ErrInvalidCSR, respPayload.Error)
		}
		return nil, fmt.Errorf("%w: HTTP %d: %s", ErrGatewayFailed, resp.StatusCode, respPayload.Error)
	}

	if strings.TrimSpace(respPayload.CertPEM) == "" {
		logger("[LAN-TLS-PROVISION] [ERROR] Phase=EMPTY_CERT nodeID=%s empty cert_pem in 200 OK response", cleanNode)
		return nil, fmt.Errorf("%w: gateway returned empty certificate payload", ErrGatewayFailed)
	}

	// Step 5: Verify cryptographic match and atomically save to disk
	saveStart := time.Now()
	if err := SaveDeviceCertificate(cleanNode, []byte(respPayload.CertPEM)); err != nil {
		logger("[LAN-TLS-PROVISION] [ERROR] Phase=VERIFY_SAVE nodeID=%s error=%v", cleanNode, err)
		if errors.Is(err, ErrCertKeyMismatch) || strings.Contains(err.Error(), "does not match") {
			return nil, fmt.Errorf("%w: %v", ErrCertKeyMismatch, err)
		}
		return nil, fmt.Errorf("failed to persist verified certificate: %w", err)
	}

	// Step 6: Load active certificate and return validated result
	finalCert, err := GetDeviceCertificate(cleanNode)
	if err != nil {
		return nil, fmt.Errorf("failed to reload newly provisioned certificate: %w", err)
	}
	expiry, _ := GetCertificateExpiry(finalCert)

	logger("[LAN-TLS-PROVISION] [SUCCESS] Dedicated certificate successfully provisioned and committed for nodeID=%s in %s (expiresAt=%s)",
		cleanNode, time.Since(startTime), expiry.Format(time.RFC3339))

	_ = saveStart // used for timing documentation

	return &ProvisionResult{
		Certificate: finalCert,
		NodeID:      cleanNode,
		ExpiresAt:   expiry,
		IsNew:       true,
	}, nil
}
