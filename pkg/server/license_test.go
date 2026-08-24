package server

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The hex seed of our Ed25519 private key (same as generated in scratch script)
const testPrivateKeySeedHex = "fc0993ec4a68da7e6f10be87959d8ecd7f227ddd4b9e65a7b925287b9b2ed12e"

func signTestPayload(cert LicenseCertificate) string {
	seedBytes, _ := hex.DecodeString(testPrivateKeySeedHex)
	privKey := ed25519.NewKeyFromSeed(seedBytes)

	var payloadStr string
	if cert.DeviceID != "" {
		// V2 format with DeviceID
		payloadStr = fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s|%d",
			cert.LicenseCode,
			cert.Tier,
			cert.UUIDHash,
			cert.CPUHash,
			cert.DiskHash,
			cert.DeviceID,
			cert.ExpiresAt,
			cert.MaxDevices,
		)
	} else {
		// Legacy V1 format
		payloadStr = fmt.Sprintf("%s|%s|%s|%s|%s|%s|%d",
			cert.LicenseCode,
			cert.Tier,
			cert.UUIDHash,
			cert.CPUHash,
			cert.DiskHash,
			cert.ExpiresAt,
			cert.MaxDevices,
		)
	}
	payloadData := []byte(payloadStr)
	sigBytes := ed25519.Sign(privKey, payloadData)
	return hex.EncodeToString(sigBytes)
}

func signTestVerifyPayload(cert LicenseCertificate) string {
	seedBytes, _ := hex.DecodeString(testPrivateKeySeedHex)
	privKey := ed25519.NewKeyFromSeed(seedBytes)

	var payloadStr string
	if cert.DeviceID != "" {
		payloadStr = fmt.Sprintf("OK|%s|%s|%s|%s|%s|%s",
			cert.LicenseCode,
			cert.UUIDHash,
			cert.CPUHash,
			cert.DiskHash,
			cert.DeviceID,
			cert.LastOnlineSyncTime,
		)
	} else {
		payloadStr = fmt.Sprintf("OK|%s|%s|%s|%s|%s",
			cert.LicenseCode,
			cert.UUIDHash,
			cert.CPUHash,
			cert.DiskHash,
			cert.LastOnlineSyncTime,
		)
	}
	payloadData := []byte(payloadStr)
	sigBytes := ed25519.Sign(privKey, payloadData)
	return hex.EncodeToString(sigBytes)
}

func TestVerifyLicenseSignature(t *testing.T) {
	cert := LicenseCertificate{
		LicenseCode: "EQT-PLUS-20260619-TESTKEY",
		Tier:        "PLUS",
		UUIDHash:    "uuid_hash_val",
		CPUHash:     "cpu_hash_val",
		DiskHash:    "disk_hash_val",
		ExpiresAt:   "LIFETIME",
		MaxDevices:  2,
	}

	// 1. Valid V1 Legacy Signature Test
	cert.Signature = signTestPayload(cert)
	if !VerifyLicenseSignature(cert) {
		t.Error("expected signature validation to pass for valid V1 cert signature")
	}

	// 2. Valid V2 Signature Test (with DeviceID)
	certV2 := cert
	certV2.DeviceID = "dev_32hex_random_device_id_9999"
	certV2.Signature = signTestPayload(certV2)
	if !VerifyLicenseSignature(certV2) {
		t.Error("expected signature validation to pass for valid V2 cert signature with DeviceID")
	}

	// 2. Tampered Payload Test
	tamperedCert := cert
	tamperedCert.Tier = "PRO" // Change tier without resigning
	if VerifyLicenseSignature(tamperedCert) {
		t.Error("expected signature validation to fail for tampered payload")
	}

	// 3. Invalid Signature Format Test
	invalidSigCert := cert
	invalidSigCert.Signature = "invalidhexstring"
	if VerifyLicenseSignature(invalidSigCert) {
		t.Error("expected signature validation to fail for invalid signature hex")
	}
}

func TestVerifyFingerprintWeightedModel(t *testing.T) {
	// Backup original mock values
	origUUID := testBoardUUID
	origCPU := testCPUSerial
	origDisk := testDiskSerial
	defer func() {
		testBoardUUID = origUUID
		testCPUSerial = origCPU
		testDiskSerial = origDisk
	}()

	tests := []struct {
		name       string
		certUUID   string
		certCPU    string
		certDisk   string
		mockUUID   string
		mockCPU    string
		mockDisk   string
		wantResult bool
	}{
		{
			name:       "All 3 match",
			certUUID:   "uuid1",
			certCPU:    "cpu1",
			certDisk:   "disk1",
			mockUUID:   "uuid1",
			mockCPU:    "cpu1",
			mockDisk:   "disk1",
			wantResult: true,
		},
		{
			name:       "2 match (Disk changed/replaced)",
			certUUID:   "uuid1",
			certCPU:    "cpu1",
			certDisk:   "disk1",
			mockUUID:   "uuid1",
			mockCPU:    "cpu1",
			mockDisk:   "disk_changed",
			wantResult: true,
		},
		{
			name:       "2 match (Motherboard UUID changed)",
			certUUID:   "uuid1",
			certCPU:    "cpu1",
			certDisk:   "disk1",
			mockUUID:   "uuid_changed",
			mockCPU:    "cpu1",
			mockDisk:   "disk1",
			wantResult: true,
		},
		{
			name:       "Only 1 match (UUID only)",
			certUUID:   "uuid1",
			certCPU:    "cpu1",
			certDisk:   "disk1",
			mockUUID:   "uuid1",
			mockCPU:    "cpu_changed",
			mockDisk:   "disk_changed",
			wantResult: false,
		},
		{
			name:       "No match",
			certUUID:   "uuid1",
			certCPU:    "cpu1",
			certDisk:   "disk1",
			mockUUID:   "uuid_other",
			mockCPU:    "cpu_other",
			mockDisk:   "disk_other",
			wantResult: false,
		},
		{
			name:       "Cert has empty fields, but 2 non-empty match",
			certUUID:   "uuid1",
			certCPU:    "cpu1",
			certDisk:   "",
			mockUUID:   "uuid1",
			mockCPU:    "cpu1",
			mockDisk:   "disk1",
			wantResult: true,
		},
		{
			name:       "Empty fields do not count as matching",
			certUUID:   "uuid1",
			certCPU:    "",
			certDisk:   "",
			mockUUID:   "uuid1",
			mockCPU:    "",
			mockDisk:   "",
			wantResult: false, // only 1 non-empty matched
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cert := LicenseCertificate{
				UUIDHash: tt.certUUID,
				CPUHash:  tt.certCPU,
				DiskHash: tt.certDisk,
			}
			testBoardUUID = tt.mockUUID
			testCPUSerial = tt.mockCPU
			testDiskSerial = tt.mockDisk

			got := VerifyFingerprint(cert)
			if got != tt.wantResult {
				t.Errorf("VerifyFingerprint() = %v, want %v", got, tt.wantResult)
			}
		})
	}
}

func TestIntegrationActivateAndLocalVerify(t *testing.T) {
	// Disable testing mock mode to enforce real signature and local file verification
	os.Setenv("EQT_TESTING", "false")
	defer os.Setenv("EQT_TESTING", "true")

	// Mock server mimicking Cloudflare Workers activation endpoint
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/activate" {
			http.NotFound(w, r)
			return
		}
		var req struct {
			LicenseCode string `json:"license_code"`
			UUIDHash    string `json:"uuid_hash"`
			CPUHash     string `json:"cpu_hash"`
			DiskHash    string `json:"disk_hash"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		cert := LicenseCertificate{
			LicenseCode: req.LicenseCode,
			Tier:        "PLUS",
			UUIDHash:    req.UUIDHash,
			CPUHash:     req.CPUHash,
			DiskHash:    req.DiskHash,
			ExpiresAt:   "LIFETIME",
			MaxDevices:  2,
		}
		cert.LastOnlineSyncTime = time.Now().Format(time.RFC3339)
		cert.VerifySignature = signTestVerifyPayload(cert)
		cert.Signature = signTestPayload(cert)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(cert)
	}))
	defer ts.Close()

	// Redirect client to target mock server
	os.Setenv("EQT_LICENSE_SERVER", ts.URL)
	defer os.Unsetenv("EQT_LICENSE_SERVER")

	// Direct license validation cleanup first
	ResetLicense()
	defer ResetLicense()

	// 1. Initially must be unpaid
	if GetPaidStatus() {
		t.Fatal("expected initially unpaid status")
	}

	// 2. Perform online activation call
	testCode := "EQT-PLUS-20260620-TESTINTEGRATION"
	err := ActivateLicenseOnline(testCode)
	if err != nil {
		t.Fatalf("ActivateLicenseOnline failed: %v", err)
	}

	// 3. Status must immediately become paid
	if !GetPaidStatus() {
		t.Fatal("expected paid status after successful online activation")
	}

	// Check if file is written to local dir
	licPath := getLicenseFilePath()
	if _, err := os.Stat(licPath); os.IsNotExist(err) {
		t.Fatal("expected license.lic to be created on disk")
	}

	// 4. Force reset memory payment status by backing up lic file first
	licPathBak := licPath + ".bak"
	_ = os.Rename(licPath, licPathBak)

	ResetLicense() // Clears disk file (which we moved) and memory state
	if GetPaidStatus() {
		t.Fatal("failed to reset memory payment state after ResetLicense")
	}

	// Restore the lic file back to simulate local offline restoration
	_ = os.Rename(licPathBak, licPath)

	// Run offline verification
	ok := VerifyLocalLicense()
	if !ok {
		t.Fatal("expected offline license verification to succeed using license.lic on disk")
	}

	if !GetPaidStatus() {
		t.Fatal("expected paid status restored after successful offline license verification")
	}

	// 5. Verification must fail if hardware fingerprint shifts
	// Change mock values to cause 3-of-2 mismatch
	origUUID := testBoardUUID
	origCPU := testCPUSerial
	origDisk := testDiskSerial
	testBoardUUID = "different_uuid"
	testCPUSerial = "different_cpu"
	testDiskSerial = "different_disk"

	defer func() {
		testBoardUUID = origUUID
		testCPUSerial = origCPU
		testDiskSerial = origDisk
	}()

	limiterInstance.SetPaidDetails(false, "", "", "") // reset memory state again
	ok2 := VerifyLocalLicense()
	if ok2 {
		t.Fatal("expected offline verification to fail after hardware fingerprint mismatched")
	}
	if GetPaidStatus() {
		t.Fatal("expected unpaid status when fingerprint validation fails")
	}
}

func TestForceOnlineLicenseSyncReplacesCertificateForTierChange(t *testing.T) {
	os.Setenv("EQT_TESTING", "false")
	defer os.Setenv("EQT_TESTING", "true")

	const licenseCode = "EQT-PLUS-20260722-SYNC"
	const expiresAt = "2030-01-01T00:00:00Z"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			LicenseCode string `json:"license_code"`
			UUIDHash    string `json:"uuid_hash"`
			CPUHash     string `json:"cpu_hash"`
			DiskHash    string `json:"disk_hash"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		switch r.URL.Path {
		case "/api/v1/activate":
			cert := LicenseCertificate{
				LicenseCode: licenseCode,
				Tier:        "PLUS",
				UUIDHash:    req.UUIDHash,
				CPUHash:     req.CPUHash,
				DiskHash:    req.DiskHash,
				ExpiresAt:   "LIFETIME",
				MaxDevices:  2,
			}
			cert.LastOnlineSyncTime = time.Now().UTC().Format(time.RFC3339)
			cert.Signature = signTestPayload(cert)
			cert.VerifySignature = signTestVerifyPayload(cert)
			_ = json.NewEncoder(w).Encode(cert)
		case "/api/v1/verify":
			if req.LicenseCode != licenseCode {
				http.Error(w, "unexpected license code", http.StatusBadRequest)
				return
			}
			cert := LicenseCertificate{
				LicenseCode:      licenseCode,
				Tier:             "PRO",
				UUIDHash:         req.UUIDHash,
				CPUHash:          req.CPUHash,
				DiskHash:         req.DiskHash,
				ExpiresAt:        expiresAt,
				MaxDevices:       3,
				ActivatedDevices: 1,
				BuyerEmail:       "buyer@example.com",
			}
			cert.LastOnlineSyncTime = time.Now().UTC().Format(time.RFC3339)
			cert.Signature = signTestPayload(cert)
			cert.VerifySignature = signTestVerifyPayload(cert)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":                "OK",
				"license_code":          cert.LicenseCode,
				"tier":                  cert.Tier,
				"uuid_hash":             cert.UUIDHash,
				"cpu_hash":              cert.CPUHash,
				"disk_hash":             cert.DiskHash,
				"max_devices":           cert.MaxDevices,
				"activated_devices":     cert.ActivatedDevices,
				"expires_at":            cert.ExpiresAt,
				"buyer_email":           cert.BuyerEmail,
				"certificate_signature": cert.Signature,
				"current_time":          cert.LastOnlineSyncTime,
				"signature":             cert.VerifySignature,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	os.Setenv("EQT_LICENSE_SERVER", ts.URL)
	defer os.Unsetenv("EQT_LICENSE_SERVER")
	ResetLicense()
	defer ResetLicense()

	if err := ActivateLicenseOnline(licenseCode); err != nil {
		t.Fatalf("ActivateLicenseOnline() error = %v", err)
	}
	if err := ForceOnlineLicenseSync(); err != nil {
		t.Fatalf("ForceOnlineLicenseSync() error = %v", err)
	}

	cert, ok := GetLocalLicenseInfo()
	if !ok {
		t.Fatal("expected synchronized license in cache")
	}
	if cert.Tier != "PRO" || cert.ExpiresAt != expiresAt || cert.MaxDevices != 3 || cert.ActivatedDevices != 1 {
		t.Fatalf("synchronized certificate = %+v, want PRO certificate fields", cert)
	}

	// Simulate a process restart: only a valid re-signed certificate may restore PRO.
	licenseCacheMu.Lock()
	cachedLicense = nil
	hasCachedLicense = false
	licenseCacheMu.Unlock()
	SetPaidStatus(false, "", "", "")
	if !VerifyLocalLicense() {
		t.Fatal("expected re-signed synchronized certificate to verify after restart")
	}
	if !GetPaidStatus() || GetLicenseTier() != "PRO" {
		t.Fatalf("restored status = paid:%t tier:%s, want paid PRO", GetPaidStatus(), GetLicenseTier())
	}
}

func TestVerifyLocalLicenseNoFileClearsPaidStatus(t *testing.T) {
	ResetLicense()
	defer ResetLicense()

	// Simulate stale in-memory paid entitlement after external unbind wiped disk late.
	SetPaidStatus(true, time.Now().UTC().Format(time.RFC3339), "LIFETIME", "PLUS")
	if !GetPaidStatus() {
		t.Fatal("precondition: expected paid status before verify")
	}
	if VerifyLocalLicense() {
		t.Fatal("expected verify to fail when license.lic is missing")
	}
	if GetPaidStatus() {
		t.Fatal("expected paid status cleared when no local certificate exists")
	}
}

func TestForceOnlineLicenseSyncUnboundDeviceResetsLicense(t *testing.T) {
	os.Setenv("EQT_TESTING", "false")
	defer os.Setenv("EQT_TESTING", "true")

	const licenseCode = "EQT-PLUS-20260722-UNBIND"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			LicenseCode string `json:"license_code"`
			UUIDHash    string `json:"uuid_hash"`
			CPUHash     string `json:"cpu_hash"`
			DiskHash    string `json:"disk_hash"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)

		switch r.URL.Path {
		case "/api/v1/activate":
			cert := LicenseCertificate{
				LicenseCode: licenseCode,
				Tier:        "PLUS",
				UUIDHash:    req.UUIDHash,
				CPUHash:     req.CPUHash,
				DiskHash:    req.DiskHash,
				ExpiresAt:   "LIFETIME",
				MaxDevices:  2,
			}
			cert.LastOnlineSyncTime = time.Now().UTC().Format(time.RFC3339)
			cert.Signature = signTestPayload(cert)
			cert.VerifySignature = signTestVerifyPayload(cert)
			_ = json.NewEncoder(w).Encode(cert)
		case "/api/v1/verify":
			// Portal unbind removes this device from activations → 403.
			http.Error(w, `{"error":"This device is not activated under the provided license"}`, http.StatusForbidden)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	os.Setenv("EQT_LICENSE_SERVER", ts.URL)
	defer os.Unsetenv("EQT_LICENSE_SERVER")
	ResetLicense()
	defer ResetLicense()

	if err := ActivateLicenseOnline(licenseCode); err != nil {
		t.Fatalf("ActivateLicenseOnline() error = %v", err)
	}
	if !GetPaidStatus() {
		t.Fatal("expected paid after activation")
	}

	err := ForceOnlineLicenseSync()
	if err == nil {
		t.Fatal("expected ForceOnlineLicenseSync to fail after device unbind")
	}
	if GetPaidStatus() {
		t.Fatal("expected unpaid status after online unbind reconciliation")
	}
	if _, ok := GetLocalLicenseInfo(); ok {
		t.Fatal("expected local certificate removed after unbind")
	}
}

func TestPrecomputeFingerprintsNonBlocking(t *testing.T) {
	// Reset states
	fingerprintMu.Lock()
	hasCached = false
	precomputeStarted = false
	cachedUUID = ""
	cachedCPU = ""
	cachedDisk = ""
	fingerprintMu.Unlock()

	// 1. When precompute is not started and not cached, it should sync retrieve and block/compute
	testBoardUUID = "mock_uuid"
	testCPUSerial = "mock_cpu"
	testDiskSerial = "mock_disk"

	uuid, cpu, disk := GetDeviceFingerprintHashes()
	if uuid != "mock_uuid" || cpu != "mock_cpu" || disk != "mock_disk" {
		t.Errorf("GetDeviceFingerprintHashes returned unexpected values: %s, %s, %s", uuid, cpu, disk)
	}
	testBoardUUID = ""
	testCPUSerial = ""
	testDiskSerial = ""

	// Reset cached state for next step
	fingerprintMu.Lock()
	hasCached = false
	precomputeStarted = false
	fingerprintMu.Unlock()

	// 2. Mark precomputeStarted as true, and hasCached as false.
	// It should return empty values immediately without blocking
	fingerprintMu.Lock()
	precomputeStarted = true
	fingerprintMu.Unlock()

	uuid2, cpu2, disk2 := GetDeviceFingerprintHashes()
	if uuid2 != "" || cpu2 != "" || disk2 != "" {
		t.Errorf("expected empty hashes in non-blocking precomputing state, got: %s, %s, %s", uuid2, cpu2, disk2)
	}

	// 3. When background precomputation is completed (hasCached = true), it should return cached values
	fingerprintMu.Lock()
	cachedUUID = "cached_uuid"
	cachedCPU = "cached_cpu"
	cachedDisk = "cached_disk"
	hasCached = true
	fingerprintMu.Unlock()

	uuid3, cpu3, disk3 := GetDeviceFingerprintHashes()
	if uuid3 != "cached_uuid" || cpu3 != "cached_cpu" || disk3 != "cached_disk" {
		t.Errorf("expected cached hashes, got: %s, %s, %s", uuid3, cpu3, disk3)
	}
}

func TestActivateLicenseOnlineWithLang(t *testing.T) {
	var receivedLang string
	var receivedAcceptLang string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/device/unbind" {
			_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
			return
		}
		var req map[string]string
		_ = json.NewDecoder(r.Body).Decode(&req)
		receivedLang = req["lang"]
		receivedAcceptLang = r.Header.Get("Accept-Language")

		cert := LicenseCertificate{
			LicenseCode: "TEST-LANG-CODE",
			Tier:        "PLUS",
			UUIDHash:    req["uuid_hash"],
			CPUHash:     req["cpu_hash"],
			DiskHash:    req["disk_hash"],
			ExpiresAt:   "LIFETIME",
			MaxDevices:  2,
		}
		cert.LastOnlineSyncTime = time.Now().UTC().Format(time.RFC3339)
		cert.Signature = signTestPayload(cert)
		cert.VerifySignature = signTestVerifyPayload(cert)
		_ = json.NewEncoder(w).Encode(cert)
	}))
	defer ts.Close()

	os.Setenv("EQT_LICENSE_SERVER", ts.URL)
	defer os.Unsetenv("EQT_LICENSE_SERVER")
	ResetLicense()
	defer ResetLicense()

	// 1. Test explicit language passing
	if err := ActivateLicenseOnlineWithLang("TEST-LANG-CODE", "ja"); err != nil {
		t.Fatalf("ActivateLicenseOnlineWithLang failed: %v", err)
	}
	if receivedLang != "ja" || receivedAcceptLang != "ja" {
		t.Errorf("expected lang='ja', got lang='%s', Accept-Language='%s'", receivedLang, receivedAcceptLang)
	}

	// 2. Test empty language passing (should fallback to default config language 'zh')
	ResetLicense()
	if err := ActivateLicenseOnline("TEST-LANG-CODE"); err != nil {
		t.Fatalf("ActivateLicenseOnline failed: %v", err)
	}
	if receivedLang != "zh" || receivedAcceptLang != "zh" {
		t.Errorf("expected default fallback lang='zh', got lang='%s', Accept-Language='%s'", receivedLang, receivedAcceptLang)
	}
}

func TestZeroComponentActivationRejection(t *testing.T) {
	// Force all hardware fingerprints to be empty
	fingerprintMu.Lock()
	cachedUUID = ""
	cachedCPU = ""
	cachedDisk = ""
	hasCached = true
	fingerprintMu.Unlock()

	origUUID := testBoardUUID
	origCPU := testCPUSerial
	origDisk := testDiskSerial
	testBoardUUID = ""
	testCPUSerial = ""
	testDiskSerial = ""
	defer func() {
		testBoardUUID = origUUID
		testCPUSerial = origCPU
		testDiskSerial = origDisk
		fingerprintMu.Lock()
		hasCached = false
		precomputeStarted = false
		fingerprintMu.Unlock()
	}()

	err := ActivateLicenseOnlineWithLang("TEST-ZERO-COMP", "en")
	if err == nil {
		t.Fatal("expected error when activating with 0 hardware components, got nil")
	}
	if !strings.Contains(err.Error(), "insufficient hardware permissions") {
		t.Errorf("expected error message to contain 'insufficient hardware permissions', got: %v", err)
	}
}

func TestRegisterDeviceOnlineAndAuthorityID(t *testing.T) {
	// Setup mock registration server
	mockID := "dev_mock_hex_1234567890abcdef"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/device/register" && r.Method == "POST" {
			_ = json.NewEncoder(w).Encode(map[string]string{
				"device_id": mockID,
				"tier":      "free",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer ts.Close()

	os.Setenv("EQT_LICENSE_SERVER", ts.URL)
	defer os.Unsetenv("EQT_LICENSE_SERVER")

	ResetLicense()
	SetAuthorityDeviceID("")

	// Ensure fingerprint is non-empty for test
	testBoardUUID = "board_uuid_test"
	defer func() { testBoardUUID = "" }()

	RegisterDeviceOnline()

	authorityID := GetAuthorityDeviceID()
	if authorityID != mockID {
		t.Errorf("expected authority device_id '%s', got '%s'", mockID, authorityID)
	}

	// Stable ID alias should also return authoritative ID
	stableID := GetDeviceStableID()
	if stableID != mockID {
		t.Errorf("expected GetDeviceStableID() to return '%s', got '%s'", mockID, stableID)
	}
}

func TestRegisterDeviceOnlineTelemetryDisabled(t *testing.T) {
	called := false
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"device_id":"should_not_be_called"}`))
	}))
	defer ts.Close()

	os.Setenv("EQT_LICENSE_SERVER", ts.URL)
	defer os.Unsetenv("EQT_LICENSE_SERVER")

	ResetLicense()
	SetAuthorityDeviceID("")

	testBoardUUID = "board_uuid_test"
	defer func() { testBoardUUID = "" }()

	// Set telemetry disabled via env var
	os.Setenv("EQT_ENABLE_TELEMETRY", "false")
	defer os.Unsetenv("EQT_ENABLE_TELEMETRY")

	RegisterDeviceOnline()

	if called {
		t.Error("expected RegisterDeviceOnline to skip network request when telemetry is disabled")
	}
	if id := GetAuthorityDeviceID(); id != "" {
		t.Errorf("expected device_id to remain empty '', got '%s'", id)
	}
}

func TestDeviceIDFormatValidationAndNegativeCaching(t *testing.T) {
	// Test isValidDeviceID
	validCases := []string{
		"12345678",
		"dev_mock_hex_1234567890abcdef",
		"4ebbecd6982f4ca6ab347734a5245382",
		"dev-1234-abcd_5678",
	}
	for _, id := range validCases {
		if !isValidDeviceID(id) {
			t.Errorf("expected '%s' to be valid device ID", id)
		}
	}

	invalidCases := []string{
		"",
		"short",
		"has space 1234",
		"corrupt\x00\xff\xfe12345678",
		"invalid@char!12345678",
		strings.Repeat("a", 130), // too long (>128)
	}
	for _, id := range invalidCases {
		if isValidDeviceID(id) {
			t.Errorf("expected '%s' to be invalid device ID", id)
		}
	}

	// Test corrupted disk cache handling
	tmpDir := t.TempDir()
	os.Setenv("EQT_CONFIG_DIR", tmpDir)
	defer os.Unsetenv("EQT_CONFIG_DIR")

	ResetLicense()
	corruptedPath := filepath.Join(tmpDir, "device_id.dat")
	_ = os.WriteFile(corruptedPath, []byte("bad@binary\x00data"), 0600)

	// Reset in-memory check flag to force disk probe
	authorityDeviceIdMu.Lock()
	authorityDeviceId = ""
	authorityDeviceIdChecked = false
	authorityDeviceIdMu.Unlock()

	// Should reject corrupted file, delete it, and return empty string
	got := GetAuthorityDeviceID()
	if got != "" {
		t.Errorf("expected empty string for corrupted cache, got '%s'", got)
	}
	if _, err := os.Stat(corruptedPath); !os.IsNotExist(err) {
		t.Errorf("expected corrupted device_id.dat to be removed, but it still exists")
	}

	// Test negative caching: consecutive calls should return "" from memory
	if id := GetAuthorityDeviceID(); id != "" {
		t.Errorf("expected negative cached empty string, got '%s'", id)
	}

	// Test valid cache write & read
	validID := "dev_valid_disk_id_12345678"
	SetAuthorityDeviceID(validID)
	if id := GetAuthorityDeviceID(); id != validID {
		t.Errorf("expected '%s', got '%s'", validID, id)
	}

	// Reset authority device ID and verify cleanup
	SetAuthorityDeviceID("")
	if id := GetAuthorityDeviceID(); id != "" {
		t.Errorf("expected empty string after SetAuthorityDeviceID(''), got '%s'", id)
	}
	if _, err := os.Stat(corruptedPath); !os.IsNotExist(err) {
		t.Errorf("expected device_id.dat to be removed after SetAuthorityDeviceID(''), but it still exists")
	}
}

func TestOnlineSyncDeviceIDUpdate(t *testing.T) {
	testBoardUUID = "mock_board_uuid"
	testCPUSerial = "mock_cpu_serial"
	testDiskSerial = "mock_disk_serial"
	defer func() {
		testBoardUUID = ""
		testCPUSerial = ""
		testDiskSerial = ""
	}()

	mockServerDeviceID := "dev_server_authoritative_9999"
	var receivedReqDeviceID string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/verify" && r.Method == "POST" {
			var req map[string]string
			_ = json.NewDecoder(r.Body).Decode(&req)
			receivedReqDeviceID = req["device_id"]
			nowStr := time.Now().UTC().Format(time.RFC3339)

			dummyCert := LicenseCertificate{
				LicenseCode:        req["license_code"],
				Tier:               "PLUS",
				UUIDHash:           req["uuid_hash"],
				CPUHash:            req["cpu_hash"],
				DiskHash:           req["disk_hash"],
				DeviceID:           mockServerDeviceID,
				ExpiresAt:          "LIFETIME",
				MaxDevices:         2,
				LastOnlineSyncTime: nowStr,
			}
			certSig := signTestPayload(dummyCert)
			syncSig := signTestVerifyPayload(dummyCert)

			resp := map[string]interface{}{
				"status":                "OK",
				"license_code":          req["license_code"],
				"tier":                  "PLUS",
				"uuid_hash":             req["uuid_hash"],
				"cpu_hash":              req["cpu_hash"],
				"disk_hash":             req["disk_hash"],
				"device_id":             mockServerDeviceID,
				"max_devices":           2,
				"activated_devices":     1,
				"expires_at":            "LIFETIME",
				"buyer_email":           "buyer@example.com",
				"certificate_signature": certSig,
				"current_time":          nowStr,
				"signature":             syncSig,
			}
			_ = json.NewEncoder(w).Encode(resp)
			return
		}
		http.NotFound(w, r)
	}))
	defer ts.Close()

	os.Setenv("EQT_LICENSE_SERVER", ts.URL)
	defer os.Unsetenv("EQT_LICENSE_SERVER")

	ResetLicense()
	defer ResetLicense()

	initialCert := LicenseCertificate{
		LicenseCode:        "TEST-SYNC-DEV-ID",
		Tier:               "PLUS",
		UUIDHash:           "mock_board_uuid",
		CPUHash:            "mock_cpu_serial",
		DiskHash:           "mock_disk_serial",
		DeviceID:           "dev_old_local_id",
		ExpiresAt:          "LIFETIME",
		MaxDevices:         2,
		LastOnlineSyncTime: time.Now().Add(-24 * time.Hour).UTC().Format(time.RFC3339),
	}
	initialCert.Signature = signTestPayload(initialCert)
	initialCert.VerifySignature = signTestVerifyPayload(initialCert)

	path := getLicenseFilePath()
	_ = os.MkdirAll(filepath.Dir(path), 0755)
	b, _ := json.Marshal(initialCert)
	_ = os.WriteFile(path, b, 0644)

	licenseCacheMu.Lock()
	cachedLicense = nil
	hasCachedLicense = false
	licenseCacheMu.Unlock()

	if !VerifyLocalLicense() {
		t.Fatal("VerifyLocalLicense failed for initialCert in test")
	}

	err := ForceOnlineLicenseSync()
	if err != nil {
		t.Fatalf("ForceOnlineLicenseSync failed: %v", err)
	}

	updatedCert, ok := GetLocalLicenseInfo()
	if !ok {
		t.Fatal("failed to get local license info after sync")
	}
	if receivedReqDeviceID != "dev_old_local_id" {
		t.Errorf("expected verify request to transmit device_id 'dev_old_local_id', got '%s'", receivedReqDeviceID)
	}
	if updatedCert.DeviceID != mockServerDeviceID {
		t.Errorf("expected updated certificate DeviceID '%s', got '%s'", mockServerDeviceID, updatedCert.DeviceID)
	}
}

func TestCrossPlatformContractLock(t *testing.T) {
	// Lock JSON key naming contract between Go client and Workers DRM API to prevent D-8 drift
	// 1. Lock Local Certificate存盘契约
	cert := LicenseCertificate{
		LicenseCode: "CONTRACT-LOCK-101",
		Tier:        "PLUS",
		UUIDHash:    "u1",
		CPUHash:     "c1",
		DiskHash:    "d1",
		DeviceID:    "dev_32hex_id_sample_99999999",
		ExpiresAt:   "LIFETIME",
		MaxDevices:  2,
	}

	data, err := json.Marshal(cert)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("Unmarshal map failed: %v", err)
	}

	expectedCertKeys := []string{"license_code", "tier", "uuid_hash", "cpu_hash", "disk_hash", "device_id", "expires_at", "max_devices"}
	for _, key := range expectedCertKeys {
		if _, exists := m[key]; !exists {
			t.Errorf("Contract drift detected! Expected JSON key '%s' missing from LicenseCertificate serialization", key)
		}
	}

	// 2. Lock HTTP /api/v1/verify response contract struct (Preventing D-8 drift)
	mockVerifyJSON := `{
		"status": "OK",
		"license_code": "CONTRACT-LOCK-101",
		"tier": "PLUS",
		"uuid_hash": "u1",
		"cpu_hash": "c1",
		"disk_hash": "d1",
		"device_id": "dev_32hex_id_sample_99999999",
		"max_devices": 2,
		"activated_devices": 1,
		"expires_at": "LIFETIME",
		"buyer_email": "user@example.com",
		"certificate_signature": "sig_cert_test",
		"current_time": "2026-08-03T12:00:00Z",
		"signature": "sig_verify_test"
	}`

	var verifyResp VerifyAPIResponse
	if err := json.Unmarshal([]byte(mockVerifyJSON), &verifyResp); err != nil {
		t.Fatalf("Unmarshal verifyResp failed: %v", err)
	}

	if verifyResp.UUIDHash != "u1" || verifyResp.CPUHash != "c1" || verifyResp.DiskHash != "d1" || verifyResp.DeviceID != "dev_32hex_id_sample_99999999" || verifyResp.SyncSignature != "sig_verify_test" {
		t.Errorf("Contract drift detected! HTTP Verify response deserialization failed to bind fingerprint, device_id or signature fields: %+v", verifyResp)
	}
}

// TestIsTestBuildProductionDefault 锁定安全不变式:不带 eqtdev tag 的构建(含测试)恒为生产。
// 若未来有人误把 isTestBuild 默认值改为 true,此测试会失败。
func TestIsTestBuildProductionDefault(t *testing.T) {
	if IsTestBuild() {
		t.Errorf("production build (no eqtdev tag) must report IsTestBuild()=false")
	}
}

func TestRegisterPaidStatusCallback(t *testing.T) {
	ResetPaidStatusCallbacksForTest()
	t.Cleanup(ResetPaidStatusCallbacksForTest)
	ch := make(chan struct {
		paid bool
		tier string
	}, 10)

	RegisterPaidStatusCallback(func(paid bool, tier string) {
		ch <- struct {
			paid bool
			tier string
		}{paid, tier}
	})

	SetPaidStatus(true, time.Now().UTC().Format(time.RFC3339), "LIFETIME", "PRO")

	select {
	case res := <-ch:
		if !res.paid || res.tier != "PRO" {
			t.Errorf("expected paid=true tier=PRO, got paid=%t tier=%s", res.paid, res.tier)
		}
	case <-time.After(2 * time.Second):
		t.Error("expected registered callback to be called on SetPaidStatus within timeout")
	}
}

func TestSetClockTamperedTriggersCallback(t *testing.T) {
	ResetPaidStatusCallbacksForTest()
	t.Cleanup(ResetPaidStatusCallbacksForTest)
	SetClockTampered(false)
	ch := make(chan struct {
		paid bool
		tier string
	}, 10)

	RegisterPaidStatusCallback(func(paid bool, tier string) {
		ch <- struct {
			paid bool
			tier string
		}{paid, tier}
	})

	SetClockTampered(true)

	select {
	case res := <-ch:
		if res.paid {
			t.Errorf("expected paid=false when clock tampered, got paid=%t", res.paid)
		}
	case <-time.After(2 * time.Second):
		t.Error("expected registered callback to be called on SetClockTampered within timeout")
	}
}

func TestSetClockTamperedDiskPersistence(t *testing.T) {
	t.Setenv("EQT_TESTING", "true")
	ResetPaidStatusCallbacksForTest()
	t.Cleanup(ResetPaidStatusCallbacksForTest)

	// Step 1: Set clock tampered to true and verify both ClockTampered=true and IsPaid=false persist to disk
	SetClockTampered(true)

	path := getChatUsageFilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read chat usage file: %v", err)
	}
	var usage ChatUsage
	if err := json.Unmarshal(data, &usage); err != nil {
		t.Fatalf("failed to unmarshal chat usage file: %v", err)
	}
	if !usage.ClockTampered {
		t.Errorf("expected disk chat_usage.json to have ClockTampered=true, got false")
	}
	if usage.IsPaid {
		t.Errorf("expected disk chat_usage.json to have IsPaid=false when tampered, got true")
	}

	// Step 2: Set clock tampered back to false and verify disk update
	SetClockTampered(false)
	dataAfter, err := os.ReadFile(path)
	if err == nil {
		var usageAfter ChatUsage
		if err := json.Unmarshal(dataAfter, &usageAfter); err == nil {
			if usageAfter.ClockTampered {
				t.Errorf("expected disk chat_usage.json to have ClockTampered=false after reset, got true")
			}
		}
	}
}

func TestActivateInsufficientFingerprintRejection(t *testing.T) {
	testFingerprintOverride = true
	defer func() { testFingerprintOverride = false }()

	// Case 1: 0 fingerprints
	testBoardUUID = ""
	testCPUSerial = ""
	testDiskSerial = ""
	err := ActivateLicenseOnline("EQT-TEST-INS-0001")
	if err == nil || !strings.Contains(err.Error(), "insufficient hardware permissions") {
		t.Errorf("expected insufficient hardware permissions error with 0 fingerprints, got %v", err)
	}

	// Case 2: Only 1 fingerprint (e.g. only UUID on restricted environment)
	testBoardUUID = "only_one_uuid_hash"
	testCPUSerial = ""
	testDiskSerial = ""
	err1 := ActivateLicenseOnline("EQT-TEST-INS-0002")
	if err1 == nil || !strings.Contains(err1.Error(), "insufficient hardware permissions") {
		t.Errorf("expected insufficient hardware permissions error with only 1 fingerprint, got %v", err1)
	}
	testBoardUUID = ""
}

func TestSetPaidDetailsPreservesClockTampered(t *testing.T) {
	// Step 1: Set clock tampered via global API
	SetClockTampered(true)
	if !GetClockTamperedStatus() {
		t.Fatal("expected ClockTampered to be true")
	}

	// Step 2: Call SetPaidStatus with paid=false (e.g. VerifyLocalLicense failing on clock rollback)
	SetPaidStatus(false, "", "", "")
	if !GetClockTamperedStatus() {
		t.Errorf("expected ClockTampered to remain true after SetPaidStatus(false), but was reset to false")
	}

	// Step 3: Call SetPaidStatus with paid=true (legitimate activation)
	SetPaidStatus(true, time.Now().Format(time.RFC3339), "2099-01-01T00:00:00Z", "PRO")
	if GetClockTamperedStatus() {
		t.Errorf("expected ClockTampered to be reset to false after valid paid activation, but remained true")
	}

	// Clean up
	SetClockTampered(false)
	SetPaidStatus(false, "", "", "")
}

func TestLicenseReadyStateManagement(t *testing.T) {
	ResetPaidStatusCallbacksForTest()
	if IsLicenseReady() {
		t.Fatalf("expected IsLicenseReady() to be false after reset, got true")
	}

	SetLicenseReady(true)
	if !IsLicenseReady() {
		t.Fatalf("expected IsLicenseReady() to be true after SetLicenseReady(true)")
	}

	ResetPaidStatusCallbacksForTest()
	if IsLicenseReady() {
		t.Fatalf("expected IsLicenseReady() to be false after second reset")
	}

	SetPaidStatus(true, time.Now().Format(time.RFC3339), "2099-01-01T00:00:00Z", "PLUS")
	if !IsLicenseReady() {
		t.Fatalf("expected IsLicenseReady() to be true after SetPaidStatus(true, ...)")
	}

	ResetPaidStatusCallbacksForTest()
}

func TestRegisterDevStatusCallback(t *testing.T) {
	SetServerDevAuthorized(false)
	ch := make(chan bool, 5)

	RegisterDevStatusCallback(func(isDev bool) {
		ch <- isDev
	})

	// Initial registration immediate callback should emit false
	select {
	case isDev := <-ch:
		if isDev {
			t.Errorf("expected initial callback to be false, got true")
		}
	case <-time.After(1 * time.Second):
		t.Error("timeout waiting for initial RegisterDevStatusCallback")
	}

	// Change to true should trigger callback
	SetServerDevAuthorized(true)
	select {
	case isDev := <-ch:
		if !isDev {
			t.Errorf("expected changed callback to be true, got false")
		}
	case <-time.After(1 * time.Second):
		t.Error("timeout waiting for changed RegisterDevStatusCallback")
	}

	// Reset
	SetServerDevAuthorized(false)
}

