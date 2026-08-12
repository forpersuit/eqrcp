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
	"eqt/pkg/util"
	"eqt/pkg/version"
)

// defaultPublicKeyHex 声明见 env_defaults.go(生产公钥)与 env_defaults_dev.go(eqtdev 测试公钥)。

// defaultLicenseServer 声明见 env_defaults.go(生产默认值)与 env_defaults_dev.go
// (//go:build eqtdev 构建时覆盖为测试 Worker)。运行时仍可用 EQT_LICENSE_SERVER 覆盖。

// LicenseCertificate matches the signed license JSON structure returned from the API
type LicenseCertificate struct {
	LicenseCode        string `json:"license_code"`
	Tier               string `json:"tier"`
	UUIDHash           string `json:"uuid_hash"`
	CPUHash            string `json:"cpu_hash"`
	DiskHash           string `json:"disk_hash"`
	DeviceID           string `json:"device_id,omitempty"`
	ExpiresAt          string `json:"expires_at"`                      // ISO string or "LIFETIME"
	MaxDevices         int    `json:"max_devices"`                     // Maximum activation count
	ActivatedDevices   int    `json:"activated_devices"`               // Current activated devices count
	BuyerEmail         string `json:"buyer_email,omitempty"`           // Buyer email address
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

// IsTestBuild 返回当前构建是否为测试(eqtdev)构建。
// 生产构建(不带 tag)恒为 false,漏配方向永远安全。
func IsTestBuild() bool {
	return isTestBuild
}

// VerifyLicenseSignature checks the cryptographic signature of the certificate
func VerifyLicenseSignature(cert LicenseCertificate) bool {
	pubBytes, err := hex.DecodeString(defaultPublicKeyHex)
	if err != nil || len(pubBytes) != ed25519.PublicKeySize {
		return false
	}
	pubKey := ed25519.PublicKey(pubBytes)

	sigBytes, err := hex.DecodeString(cert.Signature)
	if err != nil {
		return false
	}

	// 1. Try V2 Payload format (with device_id):
	// license_code|tier|uuid_hash|cpu_hash|disk_hash|device_id|expires_at|max_devices
	v2PayloadStr := fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s|%d",
		cert.LicenseCode,
		cert.Tier,
		cert.UUIDHash,
		cert.CPUHash,
		cert.DiskHash,
		cert.DeviceID,
		cert.ExpiresAt,
		cert.MaxDevices,
	)
	if ed25519.Verify(pubKey, []byte(v2PayloadStr), sigBytes) {
		return true
	}

	// 2. Fallback to Legacy V1 Payload format (without device_id):
	// license_code|tier|uuid_hash|cpu_hash|disk_hash|expires_at|max_devices
	v1PayloadStr := fmt.Sprintf("%s|%s|%s|%s|%s|%s|%d",
		cert.LicenseCode,
		cert.Tier,
		cert.UUIDHash,
		cert.CPUHash,
		cert.DiskHash,
		cert.ExpiresAt,
		cert.MaxDevices,
	)
	return ed25519.Verify(pubKey, []byte(v1PayloadStr), sigBytes)
}

// VerifySyncSignature checks the cryptographic signature of the online sync response (Supports V2 6-field with device_id & V1 legacy)
func VerifySyncSignature(cert LicenseCertificate) bool {
	if cert.VerifySignature == "" || cert.LastOnlineSyncTime == "" {
		return false
	}
	pubBytes, err := hex.DecodeString(defaultPublicKeyHex)
	if err != nil || len(pubBytes) != ed25519.PublicKeySize {
		return false
	}
	pubKey := ed25519.PublicKey(pubBytes)

	sigBytes, err := hex.DecodeString(cert.VerifySignature)
	if err != nil {
		return false
	}

	// 1. Try V2 Sync Payload format (with device_id):
	// OK|license_code|uuid_hash|cpu_hash|disk_hash|device_id|last_online_sync_time
	v2PayloadStr := fmt.Sprintf("OK|%s|%s|%s|%s|%s|%s",
		cert.LicenseCode,
		cert.UUIDHash,
		cert.CPUHash,
		cert.DiskHash,
		cert.DeviceID,
		cert.LastOnlineSyncTime,
	)
	if ed25519.Verify(pubKey, []byte(v2PayloadStr), sigBytes) {
		return true
	}

	// 2. Fallback to Legacy V1 Sync Payload format (without device_id):
	// OK|license_code|uuid_hash|cpu_hash|disk_hash|last_online_sync_time
	v1PayloadStr := fmt.Sprintf("OK|%s|%s|%s|%s|%s",
		cert.LicenseCode,
		cert.UUIDHash,
		cert.CPUHash,
		cert.DiskHash,
		cert.LastOnlineSyncTime,
	)
	return ed25519.Verify(pubKey, []byte(v1PayloadStr), sigBytes)
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
// Any failure path clears paid status so memory never outlives a missing/invalid certificate.
func VerifyLocalLicense() bool {
	path := getLicenseFilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		// No license file found — memory must match disk (SSOT).
		SetPaidStatus(false, "", "", "")
		return false
	}

	var cert LicenseCertificate
	if err := json.Unmarshal(data, &cert); err != nil {
		SetPaidStatus(false, "", "", "")
		return false
	}

	// 1. Verify cryptographic signature
	if !VerifyLicenseSignature(cert) {
		SetPaidStatus(false, "", "", "")
		return false
	}

	// 2. Expiration check
	if cert.ExpiresAt != "LIFETIME" {
		expiry, err := time.Parse(time.RFC3339, cert.ExpiresAt)
		if err != nil {
			SetPaidStatus(false, "", "", "")
			return false
		}
		if time.Now().After(expiry) {
			SetPaidStatus(false, "", "", "")
			return false
		}
	}

	// 3. Verify hardware fingerprint matches
	if !VerifyFingerprint(cert) {
		SetPaidStatus(false, "", "", "")
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
	return ActivateLicenseOnlineWithLang(licenseCode, "")
}

// ActivateLicenseOnlineWithLang calls the CF Workers API with language metadata
func ActivateLicenseOnlineWithLang(licenseCode string, lang string) error {
	if lang == "" {
		lang = config.GetConfiguredLang()
	}

	uuid, cpu, disk := GetDeviceFingerprintHashes()
	if uuid == "" && cpu == "" && disk == "" {
		return errors.New("insufficient hardware permissions: cannot retrieve hardware fingerprints")
	}

	reqMap := map[string]string{
		"license_code": licenseCode,
		"uuid_hash":    uuid,
		"cpu_hash":     cpu,
		"disk_hash":    disk,
		"device_id":    GetDeviceStableID(),
		"app_version":  version.Version(),
	}
	if lang != "" {
		reqMap["lang"] = lang
	}

	reqBody, _ := json.Marshal(reqMap)

	apiURL := fmt.Sprintf("%s/api/v1/activate", getLicenseServer())

	client := &http.Client{Timeout: 20 * time.Second}
	req, err := http.NewRequest("POST", apiURL, bytes.NewBuffer(reqBody))
	if err != nil {
		return fmt.Errorf("activation request failed: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Trace-Id", getTraceID())
	if lang != "" {
		req.Header.Set("Accept-Language", lang)
	}

	resp, err := client.Do(req)
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

// ForceOnlineLicenseSync forces an immediate online license synchronization, ignoring rate limits.
func ForceOnlineLicenseSync() error {
	return doOnlineLicenseSync(true)
}

// StartOnlineLicenseSync triggers background license checking and synchronization with the CF Workers API.
// It is non-blocking and executes in a goroutine.
func StartOnlineLicenseSync() {
	go func() {
		_ = doOnlineLicenseSync(false)
	}()
}

// VerifyAPIResponse represents the server DRM /api/v1/verify response contract.
type VerifyAPIResponse struct {
	Status               string `json:"status"`
	LicenseCode          string `json:"license_code"`
	Tier                 string `json:"tier"`
	UUIDHash             string `json:"uuid_hash"`
	CPUHash              string `json:"cpu_hash"`
	DiskHash             string `json:"disk_hash"`
	DeviceID             string `json:"device_id"`
	MaxDevices           int    `json:"max_devices"`
	ActivatedDevices     int    `json:"activated_devices"`
	ExpiresAt            string `json:"expires_at"`
	BuyerEmail           string `json:"buyer_email"`
	CertificateSignature string `json:"certificate_signature"`
	CurrentTime          string `json:"current_time"`
	SyncSignature        string `json:"signature"`
}

func doOnlineLicenseSync(force bool) error {
	// 1. Get local license
	cert, ok := GetLocalLicenseInfo()
	if !ok {
		return errors.New("no local license file found")
	}

	// 2. Rate-limit checks: only check if at least 12 hours have passed since LastOnlineSyncTime (unless forced)
	if !force && cert.LastOnlineSyncTime != "" {
		if lastSync, err := time.Parse(time.RFC3339, cert.LastOnlineSyncTime); err == nil {
			if time.Since(lastSync) < 12*time.Hour {
				return nil
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
		"app_version":  version.Version(),
	})

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(apiURL, "application/json", bytes.NewBuffer(reqBody))
	if err != nil {
		// Network error, ignore and allow offline grace period (7 days)
		return fmt.Errorf("network error during license sync: %w", err)
	}
	defer resp.Body.Close()

	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	// 4. Handle response status
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotFound {
		// Suspended, revoked, or invalid device. Reset license.
		ResetLicense()
		return errors.New("license revoked or device unbound by server")
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned status code %d", resp.StatusCode)
	}

	var verifyResp VerifyAPIResponse
	if err := json.Unmarshal(respData, &verifyResp); err != nil {
		return fmt.Errorf("failed to parse sync response: %w", err)
	}

	if verifyResp.Status != "OK" {
		return fmt.Errorf("server returned status %s", verifyResp.Status)
	}

	// Replace all signed certificate fields together. A sync response that only
	// updates tier or expiry would invalidate the original certificate signature.
	updatedCert := LicenseCertificate{
		LicenseCode:        verifyResp.LicenseCode,
		Tier:               verifyResp.Tier,
		UUIDHash:           verifyResp.UUIDHash,
		CPUHash:            verifyResp.CPUHash,
		DiskHash:           verifyResp.DiskHash,
		DeviceID:           verifyResp.DeviceID,
		ExpiresAt:          verifyResp.ExpiresAt,
		MaxDevices:         verifyResp.MaxDevices,
		ActivatedDevices:   verifyResp.ActivatedDevices,
		BuyerEmail:         verifyResp.BuyerEmail,
		Signature:          verifyResp.CertificateSignature,
		LastOnlineSyncTime: verifyResp.CurrentTime,
		LastSeenLocalTime:  time.Now().Format(time.RFC3339),
		VerifySignature:    verifyResp.SyncSignature,
	}
	if updatedCert.LicenseCode != cert.LicenseCode || !VerifyLicenseSignature(updatedCert) {
		return errors.New("updated license certificate signature invalid")
	}
	if !VerifyFingerprint(updatedCert) {
		return errors.New("updated license certificate fingerprint mismatch")
	}
	if !VerifySyncSignature(updatedCert) {
		return errors.New("verification signature invalid")
	}
	cert = updatedCert

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
	return nil
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
	paidStateMu          sync.RWMutex
	cachedIsPaid         bool
	cachedTier           string
	cachedCodeDate       string
	cachedIsTampered     bool
	paidStatusCallbackMu sync.RWMutex
	paidStatusCallbacks  []func(paid bool, tier string)
)

// RegisterPaidStatusCallback registers a callback invoked whenever paid status changes.
func RegisterPaidStatusCallback(cb func(paid bool, tier string)) {
	if cb == nil {
		return
	}
	paidStatusCallbackMu.Lock()
	paidStatusCallbacks = append(paidStatusCallbacks, cb)
	paidStatusCallbackMu.Unlock()
}

// ResetPaidStatusCallbacksForTest clears registered callbacks for test isolation.
func ResetPaidStatusCallbacksForTest() {
	paidStatusCallbackMu.Lock()
	paidStatusCallbacks = nil
	paidStatusCallbackMu.Unlock()
}

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

	// Notify registered desktop GUI listeners
	notifyPaidStatusCallbacks(paid, tier)
}

// SetClockTampered sets the clock tampered status.
// It updates memory paid state, persists updated usage to disk via limiterInstance,
// and notifies registered callbacks without lock order reversal.
func SetClockTampered(tampered bool) {
	paidStateMu.Lock()
	oldTampered := cachedIsTampered
	cachedIsTampered = tampered
	if tampered {
		cachedIsPaid = false
	}
	paid := cachedIsPaid && !cachedIsTampered
	tier := cachedTier
	paidStateMu.Unlock()

	if limiterInstance != nil {
		limiterInstance.SetClockTampered(tampered)
	}

	if oldTampered != tampered || tampered {
		notifyPaidStatusCallbacks(paid, tier)
	}
}

func notifyPaidStatusCallbacks(paid bool, tier string) {
	paidStatusCallbackMu.RLock()
	var cbs []func(paid bool, tier string)
	if len(paidStatusCallbacks) > 0 {
		cbs = make([]func(paid bool, tier string), len(paidStatusCallbacks))
		copy(cbs, paidStatusCallbacks)
	}
	paidStatusCallbackMu.RUnlock()
	for _, cb := range cbs {
		if cb != nil {
			go cb(paid, tier)
		}
	}
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

func getTraceID() string {
	return util.TraceID()
}
