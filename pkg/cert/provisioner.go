package cert

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
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
