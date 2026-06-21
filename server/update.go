package server

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strings"
	"time"

	"eqt/version"
)

// We default to reuse the defaultPublicKeyHex from license.go
const defaultUpdatePublicKeyHex = "08443678fe8bd16e3bc306db8a08b6ea1dcf3e8edeb413f655e106374bed43ac"

// UpdateAsset represents a release asset from the update server
type UpdateAsset struct {
	Name        string `json:"name"`
	DownloadURL string `json:"download_url"`
	Size        int64  `json:"size"`
}

// UpdateResponse represents the response format of our Cloudflare Workers update endpoint
type UpdateResponse struct {
	Version     string        `json:"version"`
	PublishedAt string        `json:"published_at"`
	Changelog   string        `json:"changelog"`
	Assets      []UpdateAsset `json:"assets"`
}

// CheckResult contains findings of the update check
type CheckResult struct {
	NewVersionAvailable bool   `json:"new_version_available"`
	Version             string `json:"version"`
	Changelog           string `json:"changelog"`
	AssetURL            string `json:"asset_url"`
	AssetName           string `json:"asset_name"`
	AssetSize           int64  `json:"asset_size"`
	SignatureURL        string `json:"signature_url"`
}

// VerifyUpdateSignature checks if the downloaded updates match our built-in Ed25519 key.
// The signature payload is the SHA-256 hash bytes of the package file.
func VerifyUpdateSignature(fileBytes []byte, sigBytes []byte) bool {
	pubBytes, err := hex.DecodeString(defaultUpdatePublicKeyHex)
	if err != nil || len(pubBytes) != ed25519.PublicKeySize {
		return false
	}
	pubKey := ed25519.PublicKey(pubBytes)

	// Calculate SHA-256 of downloaded file
	hash := sha256.Sum256(fileBytes)

	// Clean signature bytes
	sig := sigBytes
	sigStr := strings.TrimSpace(string(sigBytes))
	
	// If it is hex string format signature (128 hex chars), decode it
	if len(sigStr) == 128 {
		if decoded, err := hex.DecodeString(sigStr); err == nil {
			sig = decoded
		}
	}

	if len(sig) != ed25519.SignatureSize {
		return false
	}

	return ed25519.Verify(pubKey, hash[:], sig)
}

// CheckForUpdates queries the update server for a newer version matching the OS/Arch.
// If isDesktop is true, it looks for "eqt-desktop-*" assets. Otherwise "eqt-cli-*".
func CheckForUpdates(isDesktop bool, currentVersion string) (*CheckResult, error) {
	apiURL := fmt.Sprintf("%s/api/v1/update/check", getLicenseServer())
	
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create update request: %w", err)
	}
	
	req.Header.Set("User-Agent", "EQT-Update-Client")
	
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("update check request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned status code %d", resp.StatusCode)
	}

	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read update response: %w", err)
	}

	var updateRes UpdateResponse
	if err := json.Unmarshal(respData, &updateRes); err != nil {
		return nil, fmt.Errorf("failed to decode update response: %w", err)
	}

	// 1. Anti-Downgrade & Version Comparison
	if !version.IsNewerVersion(currentVersion, updateRes.Version) {
		return &CheckResult{NewVersionAvailable: false}, nil
	}

	// 2. Identify the target main asset and signature asset based on platform and type (Desktop vs CLI)
	var typeStr string
	if isDesktop {
		typeStr = "desktop"
	} else {
		typeStr = "cli"
	}

	// Target pattern: eqt-<type>-<goos>-<goarch> (e.g. eqt-desktop-windows-amd64)
	targetBase := fmt.Sprintf("eqt-%s-%s-%s", typeStr, runtime.GOOS, runtime.GOARCH)

	var mainAsset *UpdateAsset
	var sigAsset *UpdateAsset

	for i := range updateRes.Assets {
		asset := &updateRes.Assets[i]
		if strings.HasPrefix(asset.Name, targetBase) {
			if strings.HasSuffix(asset.Name, ".sig") {
				sigAsset = asset
			} else {
				mainAsset = asset
			}
		}
	}

	// Check if both main and signature assets exist
	if mainAsset == nil {
		return nil, fmt.Errorf("no main update package asset found for pattern %s", targetBase)
	}
	if sigAsset == nil {
		return nil, fmt.Errorf("no signature asset (.sig) found for package %s", mainAsset.Name)
	}

	return &CheckResult{
		NewVersionAvailable: true,
		Version:             updateRes.Version,
		Changelog:           updateRes.Changelog,
		AssetURL:            mainAsset.DownloadURL,
		AssetName:           mainAsset.Name,
		AssetSize:           mainAsset.Size,
		SignatureURL:        sigAsset.DownloadURL,
	}, nil
}
