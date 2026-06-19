package server

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"eqt/config"
)

// Default Ed25519 public key corresponding to our Cloudflare Workers private key
const defaultPublicKeyHex = "08443678fe8bd16e3bc306db8a08b6ea1dcf3e8edeb413f655e106374bed43ac"

// Default DRM API Server, can be overridden by environment variable EQT_LICENSE_SERVER
const defaultLicenseServer = "https://lic.246146.xyz"

// LicenseCertificate matches the signed license JSON structure returned from the API
type LicenseCertificate struct {
	LicenseCode string `json:"license_code"`
	Tier        string `json:"tier"`
	UUIDHash    string `json:"uuid_hash"`
	CPUHash     string `json:"cpu_hash"`
	DiskHash    string `json:"disk_hash"`
	ExpiresAt   string `json:"expires_at"`  // ISO string or "LIFETIME"
	MaxDevices  int    `json:"max_devices"` // Maximum activation count
	Signature   string `json:"signature"`   // Ed25519 signature in hex
}

func getLicenseFilePath() string {
	return filepath.Join(config.DefaultConfigDir(), "license.lic")
}

func getLicenseServer() string {
	if envServer := os.Getenv("EQT_LICENSE_SERVER"); envServer != "" {
		return strings.TrimRight(envServer, "/")
	}
	return defaultLicenseServer
}

// VerifyLicenseSignature checks the cryptographic signature of the certificate
func VerifyLicenseSignature(cert LicenseCertificate) bool {
	pubBytes, err := hex.DecodeString(defaultPublicKeyHex)
	if err != nil || len(pubBytes) != ed25519.PublicKeySize {
		return false
	}
	pubKey := ed25519.PublicKey(pubBytes)

	// Format matching worker signature payload: license_code|tier|uuid_hash|cpu_hash|disk_hash|expires_at|max_devices
	payloadStr := fmt.Sprintf("%s|%s|%s|%s|%s|%s|%d",
		cert.LicenseCode,
		cert.Tier,
		cert.UUIDHash,
		cert.CPUHash,
		cert.DiskHash,
		cert.ExpiresAt,
		cert.MaxDevices,
	)
	payloadData := []byte(payloadStr)

	sigBytes, err := hex.DecodeString(cert.Signature)
	if err != nil {
		return false
	}

	return ed25519.Verify(pubKey, payloadData, sigBytes)
}

// VerifyFingerprint checks if current hardware matches the certificate hashes using 3-of-2 model
func VerifyFingerprint(cert LicenseCertificate) bool {
	curUUID, curCPU, curDisk := GetDeviceFingerprintHashes()
	
	matches := 0
	if cert.UUIDHash != "" && curUUID != "" && cert.UUIDHash == curUUID {
		matches++
	}
	if cert.CPUHash != "" && curCPU != "" && cert.CPUHash == curCPU {
		matches++
	}
	if cert.DiskHash != "" && curDisk != "" && cert.DiskHash == curDisk {
		matches++
	}

	// 3选2模型：有至少2项一致即判定合法
	return matches >= 2
}

// VerifyLocalLicense reads the local .lic file, performs offline validation,
// and sets paid status in chat limiter accordingly.
func VerifyLocalLicense() bool {
	path := getLicenseFilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		// No license file found, ensure state matches
		return false
	}

	var cert LicenseCertificate
	if err := json.Unmarshal(data, &cert); err != nil {
		return false
	}

	// 1. Verify cryptographic signature
	if !VerifyLicenseSignature(cert) {
		return false
	}

	// 2. Expiration check
	if cert.ExpiresAt != "LIFETIME" {
		expiry, err := time.Parse(time.RFC3339, cert.ExpiresAt)
		if err != nil {
			return false
		}
		if time.Now().After(expiry) {
			return false
		}
	}

	// 3. Verify hardware fingerprint matches
	if !VerifyFingerprint(cert) {
		return false
	}

	// Verified successfully, update payment state
	SetPaidStatus(true, time.Now().Format(time.RFC3339), cert.ExpiresAt, cert.Tier)
	return true
}

// ActivateLicenseOnline calls the CF Workers API to activate this device
// with the provided license code. On success, saves .lic locally and updates state.
func ActivateLicenseOnline(licenseCode string) error {
	uuid, cpu, disk := GetDeviceFingerprintHashes()

	reqBody, _ := json.Marshal(map[string]string{
		"license_code": licenseCode,
		"uuid_hash":    uuid,
		"cpu_hash":     cpu,
		"disk_hash":    disk,
	})

	apiURL := fmt.Sprintf("%s/api/v1/activate", getLicenseServer())
	
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(apiURL, "application/json", bytes.NewBuffer(reqBody))
	if err != nil {
		return fmt.Errorf("activation request failed: %w", err)
	}
	defer resp.Body.Close()

	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var errResp struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(respData, &errResp)
		if errResp.Error != "" {
			return errors.New(errResp.Error)
		}
		return fmt.Errorf("server returned status code %d", resp.StatusCode)
	}

	var cert LicenseCertificate
	if err := json.Unmarshal(respData, &cert); err != nil {
		return fmt.Errorf("failed to decode activation certificate: %w", err)
	}

	// Perform sanity check on signature & fingerprint before saving
	if !VerifyLicenseSignature(cert) {
		return errors.New("signature verification failed on newly received license")
	}

	if !VerifyFingerprint(cert) {
		return errors.New("fingerprint check failed on newly received license")
	}

	// Save to disk
	path := getLicenseFilePath()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("failed to create config dir: %w", err)
	}
	if err := os.WriteFile(path, respData, 0644); err != nil {
		return fmt.Errorf("failed to write license file: %w", err)
	}

	// Apply activation status immediately
	SetPaidStatus(true, time.Now().Format(time.RFC3339), cert.ExpiresAt, cert.Tier)
	return nil
}

// ResetLicense deletes the local license file and updates state back to free.
func ResetLicense() {
	path := getLicenseFilePath()
	_ = os.Remove(path)
	SetPaidStatus(false, "", "", "")
}

// GetLocalLicenseInfo retrieves active license info, if any.
func GetLocalLicenseInfo() (LicenseCertificate, bool) {
	path := getLicenseFilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		return LicenseCertificate{}, false
	}
	var cert LicenseCertificate
	if err := json.Unmarshal(data, &cert); err != nil {
		return LicenseCertificate{}, false
	}
	return cert, true
}
