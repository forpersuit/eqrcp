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
	sigBytes := ed25519.Sign(privKey, payloadData)
	return hex.EncodeToString(sigBytes)
}

func signTestVerifyPayload(cert LicenseCertificate) string {
	seedBytes, _ := hex.DecodeString(testPrivateKeySeedHex)
	privKey := ed25519.NewKeyFromSeed(seedBytes)

	payloadStr := fmt.Sprintf("OK|%s|%s|%s|%s|%s",
		cert.LicenseCode,
		cert.UUIDHash,
		cert.CPUHash,
		cert.DiskHash,
		cert.LastOnlineSyncTime,
	)
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

	// 1. Valid Signature Test
	cert.Signature = signTestPayload(cert)
	if !VerifyLicenseSignature(cert) {
		t.Error("expected signature validation to pass for valid cert signature")
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
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/verify" && r.Method == "POST" {
			var req map[string]string
			_ = json.NewDecoder(r.Body).Decode(&req)
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
	if updatedCert.DeviceID != mockServerDeviceID {
		t.Errorf("expected updated certificate DeviceID '%s', got '%s'", mockServerDeviceID, updatedCert.DeviceID)
	}
}
