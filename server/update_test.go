package server

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"testing"
)

func TestVerifyUpdateSignature(t *testing.T) {
	// Reconstruct the private key corresponding to defaultUpdatePublicKeyHex
	seedBytes, err := hex.DecodeString(testPrivateKeySeedHex)
	if err != nil {
		t.Fatalf("failed to decode private key seed: %v", err)
	}
	privKey := ed25519.NewKeyFromSeed(seedBytes)

	// Fake executable binary content
	fakeBinary := []byte("this is some fake compiled binary data for EQT update testing")
	hash := sha256.Sum256(fakeBinary)

	// Sign the hash using our private key
	sigRaw := ed25519.Sign(privKey, hash[:])
	sigHex := hex.EncodeToString(sigRaw)

	// 1. Check validation with raw signature bytes
	if !VerifyUpdateSignature(fakeBinary, sigRaw) {
		t.Error("expected raw signature verification to succeed")
	}

	// 2. Check validation with hex encoded signature
	if !VerifyUpdateSignature(fakeBinary, []byte(sigHex)) {
		t.Error("expected hex-encoded signature verification to succeed")
	}

	// 3. Check failure with tampered binary
	tamperedBinary := []byte("this is some tampered compiled binary data for EQT update testing")
	if VerifyUpdateSignature(tamperedBinary, sigRaw) {
		t.Error("expected signature verification to fail for tampered binary")
	}

	// 4. Check failure with invalid signature format or corrupted sig
	corruptedSig := make([]byte, len(sigRaw))
	copy(corruptedSig, sigRaw)
	corruptedSig[0] ^= 0xFF
	if VerifyUpdateSignature(fakeBinary, corruptedSig) {
		t.Error("expected signature verification to fail for corrupted signature")
	}
}

func TestCheckForUpdates(t *testing.T) {
	// Mock releases assets list
	mockResponse := UpdateResponse{
		Version:     "v1.5.0",
		PublishedAt: "2026-06-20T12:00:00Z",
		Changelog:   "Feature A and Bug Fix B",
		Assets: []UpdateAsset{
			{
				Name:        "eqt-desktop-windows-amd64.zip",
				DownloadURL: "http://example.com/download/eqt-desktop-windows-amd64.zip",
				Size:        204800,
			},
			{
				Name:        "eqt-desktop-windows-amd64.zip.sig",
				DownloadURL: "http://example.com/download/eqt-desktop-windows-amd64.zip.sig",
				Size:        128,
			},
			{
				Name:        "eqt-cli-linux-amd64.tar.gz",
				DownloadURL: "http://example.com/download/eqt-cli-linux-amd64.tar.gz",
				Size:        102400,
			},
			{
				Name:        "eqt-cli-linux-amd64.tar.gz.sig",
				DownloadURL: "http://example.com/download/eqt-cli-linux-amd64.tar.gz.sig",
				Size:        128,
			},
		},
	}

	// Mock server returning the updates metadata
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/update/check" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(mockResponse)
	}))
	defer server.Close()

	// Redirect EQT license/update server destination
	origServerEnv := os.Getenv("EQT_LICENSE_SERVER")
	_ = os.Setenv("EQT_LICENSE_SERVER", server.URL)
	defer func() {
		if origServerEnv == "" {
			_ = os.Unsetenv("EQT_LICENSE_SERVER")
		} else {
			_ = os.Setenv("EQT_LICENSE_SERVER", origServerEnv)
		}
	}()

	// 1. Test update check when new version is available
	t.Run("Update available", func(t *testing.T) {
		// Mock testing on different combinations of GOOS/GOARCH using the mocked metadata
		// We dynamically adapt our checks since runtime.GOOS/GOARCH are immutable.
		// For the platform running the test, we mock check update.
		// E.g., if we run under linux/amd64, it should fetch linux-amd64 CLI/Desktop.
		
		// If running under linux/amd64 (common for development/WSL)
		// We try CheckForUpdates(false, "v1.4.0") -> should match eqt-cli-linux-amd64
		// If we are on windows/amd64, it should match eqt-cli-windows-amd64 (which is not in our mock assets, so it should error).
		
		res, err := CheckForUpdates(false, "v1.4.0")
		// Detect whether current OS/Arch is in our mock list:
		// We have windows-amd64 and linux-amd64 in mocks.
		if (os.Getenv("GOOS") == "" && runtime.GOOS == "linux" && runtime.GOARCH == "amd64") || 
		   (os.Getenv("GOOS") == "" && runtime.GOOS == "windows" && runtime.GOARCH == "amd64") {
			if err != nil {
				t.Fatalf("expected update check to succeed: %v", err)
			}
			if !res.NewVersionAvailable {
				t.Error("expected new version to be available")
			}
			if res.Version != "v1.5.0" {
				t.Errorf("got version %q, want v1.5.0", res.Version)
			}
			if res.Changelog != "Feature A and Bug Fix B" {
				t.Errorf("got changelog %q", res.Changelog)
			}
			if res.AssetURL == "" || res.SignatureURL == "" {
				t.Error("expected AssetURL and SignatureURL to be populated")
			}
		} else {
			// For other architectures (e.g. darwin/arm64), it should return "no main update package asset found"
			if err == nil {
				t.Error("expected update check to fail on unsupported test platform")
			}
		}
	})

	// 2. Test update check when current version is equal or newer (Anti-Downgrade)
	t.Run("No update needed", func(t *testing.T) {
		res, err := CheckForUpdates(false, "v1.5.0")
		if err != nil {
			// Accept platform unsupported error if not on linux-amd64 / windows-amd64
			if (runtime.GOOS == "linux" || runtime.GOOS == "windows") && runtime.GOARCH == "amd64" {
				t.Fatalf("expected check to succeed, got: %v", err)
			}
			return
		}
		if res.NewVersionAvailable {
			t.Error("expected no update available when versions are equal")
		}

		res2, err2 := CheckForUpdates(false, "v1.6.0")
		if err2 != nil {
			return
		}
		if res2.NewVersionAvailable {
			t.Error("expected no update available when current version is newer")
		}
	})
}
