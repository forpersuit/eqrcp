package cert

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	// BaseDomain is the root domain managed for LAN-TLS loopback.
	BaseDomain = "direct.eqt.net.im"
)

// FormatDirectDomain converts an IPv4 address to its corresponding direct.eqt.net.im domain.
// e.g. "192.168.0.201" -> "192-168-0-201.direct.eqt.net.im"
// If the input is not a valid IPv4 address, it returns the input unmodified.
func FormatDirectDomain(ipStr string) string {
	clean := strings.TrimSpace(ipStr)
	parsed := net.ParseIP(clean)
	if parsed == nil {
		return ipStr
	}
	ipv4 := parsed.To4()
	if ipv4 == nil {
		return ipStr
	}
	dashed := fmt.Sprintf("%d-%d-%d-%d", ipv4[0], ipv4[1], ipv4[2], ipv4[3])
	return fmt.Sprintf("%s.%s", dashed, BaseDomain)
}

// GetCertificate returns a tls.Certificate.
// If customCert and customKey are specified, they are read from disk.
// Otherwise, it checks the local cache (~/.config/eqt/certs).
func GetCertificate(customCert, customKey string) (tls.Certificate, error) {
	// 1. Explicit custom paths
	if customCert != "" && customKey != "" {
		return tls.LoadX509KeyPair(customCert, customKey)
	}

	// 2. Check cached certs on disk (~/.config/eqt/certs)
	if cacheCert, cacheKey, ok := getCachedCertPaths(); ok {
		if cert, err := tls.LoadX509KeyPair(cacheCert, cacheKey); err == nil {
			if !isCertExpired(cert) {
				return cert, nil
			}
		}
	}

	return tls.Certificate{}, fmt.Errorf("no valid TLS certificate available in ~/.config/eqt/certs or specified flags")
}

func getCachedCertPaths() (string, string, bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", false
	}
	dir := filepath.Join(home, ".config", "eqt", "certs")
	certFile := filepath.Join(dir, "fullchain.pem")
	keyFile := filepath.Join(dir, "privkey.pem")

	if _, err := os.Stat(certFile); err == nil {
		if _, err := os.Stat(keyFile); err == nil {
			return certFile, keyFile, true
		}
	}
	return "", "", false
}

func isCertExpired(cert tls.Certificate) bool {
	if len(cert.Certificate) == 0 {
		return true
	}
	x509Cert, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return true
	}
	// Expired if current time is past NotAfter minus 24h grace window
	return time.Now().Add(24 * time.Hour).After(x509Cert.NotAfter)
}

// GetCertificateExpiry returns the expiration time of the leaf certificate.
func GetCertificateExpiry(cert tls.Certificate) (time.Time, error) {
	if len(cert.Certificate) == 0 {
		return time.Time{}, fmt.Errorf("empty certificate chain")
	}
	x509Cert, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return time.Time{}, err
	}
	return x509Cert.NotAfter, nil
}
