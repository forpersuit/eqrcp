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
	"sync"
	"time"

	"eqt/pkg/config"
)

// Default Ed25519 public key corresponding to our Cloudflare Workers private key
const defaultPublicKeyHex = "08443678fe8bd16e3bc306db8a08b6ea1dcf3e8edeb413f655e106374bed43ac"

// Default DRM API Server, can be overridden by environment variable EQT_LICENSE_SERVER
const defaultLicenseServer = "https://lic.eqt.net.im"

// LicenseCertificate matches the signed license JSON structure returned from the API
type LicenseCertificate struct {
	LicenseCode        string `json:"license_code"`
	Tier               string `json:"tier"`
	UUIDHash           string `json:"uuid_hash"`
	CPUHash            string `json:"cpu_hash"`
	DiskHash           string `json:"disk_hash"`
	ExpiresAt          string `json:"expires_at"`                      // ISO string or "LIFETIME"
	MaxDevices         int    `json:"max_devices"`                     // Maximum activation count
	ActivatedDevices   int    `json:"activated_devices"`               // Current activated devices count
	Signature          string `json:"signature"`                       // Ed25519 signature in hex
	LastOnlineSyncTime string `json:"last_online_sync_time,omitempty"` // ISO string
	LastSeenLocalTime  string `json:"last_seen_local_time,omitempty"`  // ISO string
	VerifySignature    string `json:"verify_signature,omitempty"`      // Ed25519 signature of the sync status
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

// VerifySyncSignature checks the cryptographic signature of the online sync response
func VerifySyncSignature(cert LicenseCertificate) bool {
	if cert.VerifySignature == "" || cert.LastOnlineSyncTime == "" {
		return false
	}
	pubBytes, err := hex.DecodeString(defaultPublicKeyHex)
	if err != nil || len(pubBytes) != ed25519.PublicKeySize {
		return false
	}
	pubKey := ed25519.PublicKey(pubBytes)

	// Format matching worker sync signature payload: OK|license_code|uuid_hash|cpu_hash|disk_hash|last_online_sync_time
	payloadStr := fmt.Sprintf("OK|%s|%s|%s|%s|%s",
		cert.LicenseCode,
		cert.UUIDHash,
		cert.CPUHash,
		cert.DiskHash,
		cert.LastOnlineSyncTime,
	)
	payloadData := []byte(payloadStr)

	sigBytes, err := hex.DecodeString(cert.VerifySignature)
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

	// 4. Verify online sync signature (7-day lease confirmation) and clock rollback (enforced only when not in testing environment)
	if os.Getenv("EQT_TESTING") != "true" {
		if cert.VerifySignature != "" {
			if !VerifySyncSignature(cert) {
				SetPaidStatus(false, "", "", "")
				return false
			}
			// Sync Lease Check
			lastSync, err := time.Parse(time.RFC3339, cert.LastOnlineSyncTime)
			if err != nil {
				SetPaidStatus(false, "", "", "")
				return false
			}
			if time.Now().After(lastSync.Add(7 * 24 * time.Hour)) {
				// Lease expired
				SetPaidStatus(false, "", "", "")
				return false
			}
		} else {
			// Missing verify signature (invalid or old license without sync metadata)
			SetPaidStatus(false, "", "", "")
			return false
		}

		// 5. Anti-rollback clock check
		if cert.LastSeenLocalTime != "" {
			lastSeen, err := time.Parse(time.RFC3339, cert.LastSeenLocalTime)
			if err == nil {
				// Allow 10 minutes clock variance
				if time.Now().Before(lastSeen.Add(-10 * time.Minute)) {
					SetClockTampered(true)
					SetPaidStatus(false, "", "", "")
					return false
				}
			}
		}
	}

	// 6. Update last seen local time (limit writing to disk once per 1 minute to save I/O)
	shouldWrite := true
	if cert.LastSeenLocalTime != "" {
		if lastSeen, err := time.Parse(time.RFC3339, cert.LastSeenLocalTime); err == nil {
			if time.Since(lastSeen) < 1*time.Minute {
				shouldWrite = false
			}
		}
	}
	if shouldWrite {
		cert.LastSeenLocalTime = time.Now().Format(time.RFC3339)
		if certBytes, err := json.Marshal(cert); err == nil {
			_ = os.WriteFile(path, certBytes, 0644)
		}
	}

	// Verified successfully, update payment state
	SetPaidStatus(true, cert.LastOnlineSyncTime, cert.ExpiresAt, cert.Tier)
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

	// Save to disk with local last seen time metadata initialized
	cert.LastSeenLocalTime = time.Now().Format(time.RFC3339)
	path := getLicenseFilePath()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("failed to create config dir: %w", err)
	}
	certBytes, err := json.Marshal(cert)
	if err != nil {
		return fmt.Errorf("failed to serialize license: %w", err)
	}
	if err := os.WriteFile(path, certBytes, 0644); err != nil {
		return fmt.Errorf("failed to write license file: %w", err)
	}

	licenseCacheMu.Lock()
	cachedLicense = &cert
	hasCachedLicense = true
	licenseCacheMu.Unlock()

	// Apply activation status immediately using server verification sync time
	SetPaidStatus(true, cert.LastOnlineSyncTime, cert.ExpiresAt, cert.Tier)
	return nil
}

// StartOnlineLicenseSync triggers background license checking and synchronization with the CF Workers API.
// It is non-blocking and executes in a goroutine.
func StartOnlineLicenseSync() {
	go func() {
		// 1. Get local license
		cert, ok := GetLocalLicenseInfo()
		if !ok {
			return
		}

		// 2. Rate-limit checks: only check if at least 12 hours have passed since LastOnlineSyncTime
		if cert.LastOnlineSyncTime != "" {
			if lastSync, err := time.Parse(time.RFC3339, cert.LastOnlineSyncTime); err == nil {
				if time.Since(lastSync) < 12*time.Hour {
					return
				}
			}
		}

		// 3. Make HTTP verify request
		apiURL := fmt.Sprintf("%s/api/v1/verify", getLicenseServer())
		uuid, cpu, disk := GetDeviceFingerprintHashes()
		reqBody, _ := json.Marshal(map[string]string{
			"license_code": cert.LicenseCode,
			"uuid_hash":    uuid,
			"cpu_hash":     cpu,
			"disk_hash":    disk,
		})

		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Post(apiURL, "application/json", bytes.NewBuffer(reqBody))
		if err != nil {
			// Network error, ignore and allow offline grace period (7 days)
			return
		}
		defer resp.Body.Close()

		respData, err := io.ReadAll(resp.Body)
		if err != nil {
			return
		}

		// 4. Handle response status
		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotFound {
			// Suspended, revoked, or invalid device. Reset license.
			ResetLicense()
			return
		}

		if resp.StatusCode != http.StatusOK {
			return
		}

		var verifyResp struct {
			Status      string `json:"status"`
			LicenseCode string `json:"license_code"`
			CurrentTime string `json:"current_time"`
			Signature   string `json:"signature"`
		}
		if err := json.Unmarshal(respData, &verifyResp); err != nil {
			return
		}

		if verifyResp.Status != "OK" {
			return
		}

		// 5. Update local license with sync timestamp and sync signature
		cert.LastOnlineSyncTime = verifyResp.CurrentTime
		cert.LastSeenLocalTime = time.Now().Format(time.RFC3339)
		cert.VerifySignature = verifyResp.Signature

		// Verify before saving to prevent bad cache corruption
		if !VerifySyncSignature(cert) {
			return
		}

		path := getLicenseFilePath()
		if certBytes, err := json.Marshal(cert); err == nil {
			_ = os.WriteFile(path, certBytes, 0644)
		}

		licenseCacheMu.Lock()
		cachedLicense = &cert
		hasCachedLicense = true
		licenseCacheMu.Unlock()

		// Refresh state in memory
		SetPaidStatus(true, cert.LastOnlineSyncTime, cert.ExpiresAt, cert.Tier)
	}()
}

var (
	licenseCacheMu   sync.Mutex
	cachedLicense    *LicenseCertificate
	hasCachedLicense bool
)

// ResetLicense deletes the local license file and updates state back to free.
func ResetLicense() {
	licenseCacheMu.Lock()
	cachedLicense = nil
	hasCachedLicense = true
	licenseCacheMu.Unlock()

	path := getLicenseFilePath()
	_ = os.Remove(path)
	SetPaidStatus(false, "", "", "")
}

// GetLocalLicenseInfo retrieves active license info, if any.
func GetLocalLicenseInfo() (LicenseCertificate, bool) {
	licenseCacheMu.Lock()
	defer licenseCacheMu.Unlock()
	if hasCachedLicense {
		if cachedLicense == nil {
			return LicenseCertificate{}, false
		}
		return *cachedLicense, true
	}

	path := getLicenseFilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		cachedLicense = nil
		hasCachedLicense = true
		return LicenseCertificate{}, false
	}
	var cert LicenseCertificate
	if err := json.Unmarshal(data, &cert); err != nil {
		cachedLicense = nil
		hasCachedLicense = true
		return LicenseCertificate{}, false
	}
	cachedLicense = &cert
	hasCachedLicense = true
	return cert, true
}

var (
	paidStateMu      sync.RWMutex
	cachedIsPaid     bool
	cachedTier       string
	cachedCodeDate   string
	cachedIsTampered bool
)

// SetPaidStatus updates the payment status globally.
func SetPaidStatus(paid bool, redeemedAt string, codeDate string, tier string) {
	paidStateMu.Lock()
	cachedIsPaid = paid
	cachedTier = tier
	cachedCodeDate = codeDate
	if !paid {
		cachedTier = ""
		cachedCodeDate = ""
	}
	paidStateMu.Unlock()

	// Notify limiterInstance as well to trigger event broadcast
	if limiterInstance != nil {
		limiterInstance.SetPaidDetails(paid, redeemedAt, codeDate, tier)
	}
}

// SetClockTampered sets the clock tampered status.
func SetClockTampered(tampered bool) {
	paidStateMu.Lock()
	cachedIsTampered = tampered
	if tampered {
		cachedIsPaid = false
	}
	paidStateMu.Unlock()
}

// GetPaidStatus returns whether the premium status is activated.
func GetPaidStatus() bool {
	paidStateMu.RLock()
	defer paidStateMu.RUnlock()
	if cachedIsTampered {
		return false
	}
	return cachedIsPaid
}

// GetLicenseTier returns the current license tier (e.g. PLUS, PRO).
func GetLicenseTier() string {
	paidStateMu.RLock()
	defer paidStateMu.RUnlock()
	return cachedTier
}

// GetCodeDate returns the current license code issue date or "LIFETIME".
func GetCodeDate() string {
	paidStateMu.RLock()
	defer paidStateMu.RUnlock()
	return cachedCodeDate
}

// GetClockTamperedStatus returns whether the system clock has been tampered.
func GetClockTamperedStatus() bool {
	paidStateMu.RLock()
	defer paidStateMu.RUnlock()
	return cachedIsTampered
}
