package server

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"eqt/config"
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

func getUpdateTempDir() string {
	dir := filepath.Join(config.DefaultConfigDir(), "updates")
	_ = os.MkdirAll(dir, 0755)
	return dir
}

// DownloadUpdate downloads the update package and its signature, verifies it,
// and saves it to a persistent update buffer folder in the config directory.
func DownloadUpdate(assetURL string, sigURL string, assetName string) (string, error) {
	tempDir := getUpdateTempDir()
	
	// Create paths for saving download files
	pkgPath := filepath.Join(tempDir, assetName)
	sigPath := pkgPath + ".sig"

	client := &http.Client{Timeout: 60 * time.Second} // Larger timeout for file downloads

	// 1. Download main asset package
	resp, err := client.Get(assetURL)
	if err != nil {
		return "", fmt.Errorf("failed to download update package: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("package download returned status code %d", resp.StatusCode)
	}

	pkgBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read downloaded package: %w", err)
	}

	// 2. Download signature file
	respSig, err := client.Get(sigURL)
	if err != nil {
		return "", fmt.Errorf("failed to download update signature: %w", err)
	}
	defer respSig.Body.Close()

	if respSig.StatusCode != http.StatusOK {
		return "", fmt.Errorf("signature download returned status code %d", respSig.StatusCode)
	}

	sigBytes, err := io.ReadAll(respSig.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read downloaded signature: %w", err)
	}

	// 3. Cryptographic Signature Verification
	if !VerifyUpdateSignature(pkgBytes, sigBytes) {
		return "", fmt.Errorf("cryptographic signature verification failed for update package")
	}

	// 4. Save the verified package and signature locally
	if err := os.WriteFile(pkgPath, pkgBytes, 0644); err != nil {
		return "", fmt.Errorf("failed to save verified update package: %w", err)
	}
	if err := os.WriteFile(sigPath, sigBytes, 0644); err != nil {
		return "", fmt.Errorf("failed to save verified update signature: %w", err)
	}

	return pkgPath, nil
}

// InstallAndRestart performs atomic binary replacement and restarts the current process.
// It supports differential handling for Windows (Rename scheme) and Linux/macOS.
func InstallAndRestart(assetName string) error {
	tempDir := getUpdateTempDir()
	pkgPath := filepath.Join(tempDir, assetName)

	// Check if update file exists
	if _, err := os.Stat(pkgPath); err != nil {
		return fmt.Errorf("verified update package not found at %s: %w", pkgPath, err)
	}

	// Read new binary bytes
	newBytes, err := os.ReadFile(pkgPath)
	if err != nil {
		return fmt.Errorf("failed to read verified update package: %w", err)
	}

	// Get running executable absolute path
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get running executable path: %w", err)
	}

	// Perform platform-specific atomic replacement
	if runtime.GOOS == "windows" {
		// Windows: rename current running exe to .old, write new file to original path
		exeOldPath := exePath + ".old"
		
		// Remove existing old file if any
		_ = os.Remove(exeOldPath)

		// Rename running exe (Windows allows renaming running executables)
		if err := os.Rename(exePath, exeOldPath); err != nil {
			return fmt.Errorf("failed to rename running executable: %w", err)
		}

		// Write new binary
		if err := os.WriteFile(exePath, newBytes, 0755); err != nil {
			// Try to rollback rename if write failed
			_ = os.Rename(exeOldPath, exePath)
			return fmt.Errorf("failed to write new executable: %w", err)
		}
	} else {
		// POSIX (Linux, macOS): atomic swap with os.Rename.
		// Write new binary to a temporary file in the same directory as original exe,
		// chmod to executable, then rename to target path.
		exeDir := filepath.Dir(exePath)
		tempNewFile := filepath.Join(exeDir, filepath.Base(exePath)+".new")
		
		if err := os.WriteFile(tempNewFile, newBytes, 0755); err != nil {
			return fmt.Errorf("failed to write temporary new executable: %w", err)
		}
		
		if err := os.Chmod(tempNewFile, 0755); err != nil {
			_ = os.Remove(tempNewFile)
			return fmt.Errorf("failed to set executable permission: %w", err)
		}

		if err := os.Rename(tempNewFile, exePath); err != nil {
			_ = os.Remove(tempNewFile)
			return fmt.Errorf("failed to rename target executable: %w", err)
		}
	}

	// Clean up update package cache files
	_ = os.Remove(pkgPath)
	_ = os.Remove(pkgPath + ".sig")

	// Restart EQT: spawn a new process and exit the current one.
	// We preserve the environment variables and run arguments.
	cmd := exec.Command(exePath, os.Args[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start new EQT process: %w", err)
	}

	// Exit the current process cleanly
	os.Exit(0)
	return nil
}

// CleanLingeringOldExecutables deletes the .old executable files left by Windows rename scheme
func CleanLingeringOldExecutables() {
	if runtime.GOOS != "windows" {
		return
	}
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	exeOldPath := exePath + ".old"
	if _, err := os.Stat(exeOldPath); err == nil {
		// Attempt to delete it. If it fails (e.g. process is still shutting down), we just ignore.
		_ = os.Remove(exeOldPath)
	}
}
