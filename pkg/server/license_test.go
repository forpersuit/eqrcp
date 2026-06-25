package server

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
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
