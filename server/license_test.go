package server

import (
	"crypto/ed25519"
	"encoding/hex"
	"fmt"
	"testing"
)

// The hex seed of our Ed25519 private key (same as generated in scratch script)
const testPrivateKeySeedHex = "fc0993ec4a68da7e6f10be87959d8ecd7f227ddd4b9e65a7b925287b9b2ed12e"

func signTestPayload(cert LicenseCertificate) string {
	seedBytes, _ := hex.DecodeString(testPrivateKeySeedHex)
	privKey := ed25519.NewKeyFromSeed(seedBytes)

	payloadStr := fmt.Sprintf("%s|%s|%s|%s|%s|%s",
		cert.LicenseCode,
		cert.Tier,
		cert.UUIDHash,
		cert.CPUHash,
		cert.DiskHash,
		cert.ExpiresAt,
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
