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
	"eqt/logger"
	"eqt/version"
)

// Log is a package level logger that can be customized externally.
// By default it is quiet.
var Log = logger.New(true)

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
// VerifyUpdateSignature checks if the downloaded updates match our built-in Ed25519 key.
// The signature payload is the SHA-256 hash bytes of the package file.
func VerifyUpdateSignature(fileBytes []byte, sigBytes []byte) bool {
	Log.Debugf("VerifyUpdateSignature: package bytes size=%d, sig bytes size=%d", len(fileBytes), len(sigBytes))
	pubBytes, err := hex.DecodeString(defaultUpdatePublicKeyHex)
	if err != nil || len(pubBytes) != ed25519.PublicKeySize {
		Log.Errorf("VerifyUpdateSignature: failed to decode default public key or size is invalid: %v", err)
		return false
	}
	pubKey := ed25519.PublicKey(pubBytes)

	// Calculate SHA-256 of downloaded file
	hash := sha256.Sum256(fileBytes)
	Log.Debugf("VerifyUpdateSignature: computed SHA-256 hash=%x", hash)

	// Clean signature bytes
	sig := sigBytes
	sigStr := strings.TrimSpace(string(sigBytes))
	
	// If it is hex string format signature (128 hex chars), decode it
	if len(sigStr) == 128 {
		if decoded, err := hex.DecodeString(sigStr); err == nil {
			Log.Debugf("VerifyUpdateSignature: decoded 128-char hex signature successfully")
			sig = decoded
		} else {
			Log.Errorf("VerifyUpdateSignature: failed to decode 128-char hex signature: %v", err)
		}
	}

	if len(sig) != ed25519.SignatureSize {
		Log.Errorf("VerifyUpdateSignature: signature size is invalid, got %d, expected %d", len(sig), ed25519.SignatureSize)
		return false
	}

	verified := ed25519.Verify(pubKey, hash[:], sig)
	Log.Debugf("VerifyUpdateSignature: Ed25519 signature verify result: %v", verified)
	return verified
}

// CheckForUpdates queries the update server for a newer version matching the OS/Arch.
// If isDesktop is true, it looks for "eqt-desktop-*" assets. Otherwise "eqt-cli-*".
func CheckForUpdates(isDesktop bool, currentVersion string) (*CheckResult, error) {
	apiURL := fmt.Sprintf("%s/api/v1/update/check", getLicenseServer())
	Log.Debugf("CheckForUpdates: initiated. isDesktop: %v, currentVersion: %s, url: %s", isDesktop, currentVersion, apiURL)
	
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		Log.Errorf("CheckForUpdates: request build failed: %v", err)
		return nil, fmt.Errorf("failed to create update request: %w", err)
	}
	
	req.Header.Set("User-Agent", "EQT-Update-Client")
	
	resp, err := client.Do(req)
	if err != nil {
		Log.Errorf("CheckForUpdates: API request failed: %v", err)
		return nil, fmt.Errorf("update check request failed: %w", err)
	}
	defer resp.Body.Close()

	Log.Debugf("CheckForUpdates: response status: %d", resp.StatusCode)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned status code %d", resp.StatusCode)
	}

	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		Log.Errorf("CheckForUpdates: failed to read response body: %v", err)
		return nil, fmt.Errorf("failed to read update response: %w", err)
	}
	Log.Debugf("CheckForUpdates: raw response payload: %s", string(respData))

	var updateRes UpdateResponse
	if err := json.Unmarshal(respData, &updateRes); err != nil {
		Log.Errorf("CheckForUpdates: json decode failed: %v", err)
		return nil, fmt.Errorf("failed to decode update response: %w", err)
	}

	// 1. Anti-Downgrade & Version Comparison
	isNewer := version.IsNewerVersion(currentVersion, updateRes.Version)
	Log.Debugf("CheckForUpdates: version compare. current: %s, target: %s -> isNewer: %v", currentVersion, updateRes.Version, isNewer)
	if !isNewer {
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
	Log.Debugf("CheckForUpdates: filtering assets with base pattern: %s", targetBase)

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

	if mainAsset != nil {
		Log.Debugf("CheckForUpdates: matched main package asset: %s (url: %s, size: %d)", mainAsset.Name, mainAsset.DownloadURL, mainAsset.Size)
	}
	if sigAsset != nil {
		Log.Debugf("CheckForUpdates: matched signature asset: %s (url: %s)", sigAsset.Name, sigAsset.DownloadURL)
	}

	// Check if both main and signature assets exist
	if mainAsset == nil {
		Log.Errorf("CheckForUpdates: no main package asset found for pattern %s", targetBase)
		return nil, fmt.Errorf("no main update package asset found for pattern %s", targetBase)
	}
	if sigAsset == nil {
		Log.Errorf("CheckForUpdates: no signature asset found for package %s", mainAsset.Name)
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
	Log.Debugf("DownloadUpdate: starting download. tempDir: %s, pkgPath: %s, sigPath: %s", tempDir, pkgPath, sigPath)

	client := &http.Client{Timeout: 60 * time.Second} // Larger timeout for file downloads

	// 1. Download main asset package
	Log.Debugf("DownloadUpdate: downloading package from URL: %s", assetURL)
	resp, err := client.Get(assetURL)
	if err != nil {
		Log.Errorf("DownloadUpdate: package download failed: %v", err)
		return "", fmt.Errorf("failed to download update package: %w", err)
	}
	defer resp.Body.Close()

	Log.Debugf("DownloadUpdate: package download response status: %d", resp.StatusCode)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("package download returned status code %d", resp.StatusCode)
	}

	pkgBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		Log.Errorf("DownloadUpdate: failed to read package body: %v", err)
		return "", fmt.Errorf("failed to read downloaded package: %w", err)
	}
	Log.Debugf("DownloadUpdate: successfully downloaded package. size: %d bytes", len(pkgBytes))

	// 2. Download signature file
	Log.Debugf("DownloadUpdate: downloading signature from URL: %s", sigURL)
	respSig, err := client.Get(sigURL)
	if err != nil {
		Log.Errorf("DownloadUpdate: signature download failed: %v", err)
		return "", fmt.Errorf("failed to download update signature: %w", err)
	}
	defer respSig.Body.Close()

	Log.Debugf("DownloadUpdate: signature download response status: %d", respSig.StatusCode)
	if respSig.StatusCode != http.StatusOK {
		return "", fmt.Errorf("signature download returned status code %d", respSig.StatusCode)
	}

	sigBytes, err := io.ReadAll(respSig.Body)
	if err != nil {
		Log.Errorf("DownloadUpdate: failed to read signature body: %v", err)
		return "", fmt.Errorf("failed to read downloaded signature: %w", err)
	}
	Log.Debugf("DownloadUpdate: successfully downloaded signature. size: %d bytes", len(sigBytes))

	// 3. Cryptographic Signature Verification
	Log.Debugf("DownloadUpdate: executing cryptographic signature verification...")
	if !VerifyUpdateSignature(pkgBytes, sigBytes) {
		Log.Errorf("DownloadUpdate: signature verification failed")
		return "", fmt.Errorf("cryptographic signature verification failed for update package")
	}
	Log.Debugf("DownloadUpdate: signature verification passed")

	// 4. Save the verified package and signature locally
	Log.Debugf("DownloadUpdate: writing verified files to disk")
	if err := os.WriteFile(pkgPath, pkgBytes, 0644); err != nil {
		Log.Errorf("DownloadUpdate: failed to write package to disk: %v", err)
		return "", fmt.Errorf("failed to save verified update package: %w", err)
	}
	if err := os.WriteFile(sigPath, sigBytes, 0644); err != nil {
		Log.Errorf("DownloadUpdate: failed to write signature to disk: %v", err)
		return "", fmt.Errorf("failed to save verified update signature: %w", err)
	}
	Log.Debugf("DownloadUpdate: verified update package saved successfully at %s", pkgPath)

	return pkgPath, nil
}

// InstallAndRestart performs atomic binary replacement and restarts the current process.
// It supports differential handling for Windows (Rename scheme) and Linux/macOS.
func InstallAndRestart(assetName string) error {
	tempDir := getUpdateTempDir()
	pkgPath := filepath.Join(tempDir, assetName)
	Log.Debugf("InstallAndRestart: starting installation. tempDir: %s, pkgPath: %s", tempDir, pkgPath)

	// Check if update file exists
	if _, err := os.Stat(pkgPath); err != nil {
		Log.Errorf("InstallAndRestart: verified update package not found at %s: %v", pkgPath, err)
		return fmt.Errorf("verified update package not found at %s: %w", pkgPath, err)
	}

	// Read new binary bytes
	newBytes, err := os.ReadFile(pkgPath)
	if err != nil {
		Log.Errorf("InstallAndRestart: failed to read update package: %v", err)
		return fmt.Errorf("failed to read verified update package: %w", err)
	}

	// Get running executable absolute path
	exePath, err := os.Executable()
	if err != nil {
		Log.Errorf("InstallAndRestart: failed to get running executable path: %v", err)
		return fmt.Errorf("failed to get running executable path: %w", err)
	}
	Log.Debugf("InstallAndRestart: current running executable path: %s", exePath)

	// Perform platform-specific atomic replacement
	if runtime.GOOS == "windows" {
		exeOldPath := exePath + ".old"
		Log.Debugf("InstallAndRestart: Windows scheme - renaming %s to %s", exePath, exeOldPath)
		
		// Remove existing old file if any
		_ = os.Remove(exeOldPath)

		// Rename running exe (Windows allows renaming running executables)
		if err := os.Rename(exePath, exeOldPath); err != nil {
			Log.Errorf("InstallAndRestart: failed to rename running exe: %v", err)
			return fmt.Errorf("failed to rename running executable: %w", err)
		}
		Log.Debugf("InstallAndRestart: Windows scheme - writing new binary to %s", exePath)

		// Write new binary
		if err := os.WriteFile(exePath, newBytes, 0755); err != nil {
			Log.Errorf("InstallAndRestart: failed to write new binary, rolling back rename: %v", err)
			// Try to rollback rename if write failed
			_ = os.Rename(exeOldPath, exePath)
			return fmt.Errorf("failed to write new executable: %w", err)
		}
	} else {
		// POSIX (Linux, macOS): atomic swap with os.Rename.
		exeDir := filepath.Dir(exePath)
		tempNewFile := filepath.Join(exeDir, filepath.Base(exePath)+".new")
		Log.Debugf("InstallAndRestart: POSIX scheme - writing temp binary to %s", tempNewFile)
		
		if err := os.WriteFile(tempNewFile, newBytes, 0755); err != nil {
			Log.Errorf("InstallAndRestart: failed to write temp file: %v", err)
			return fmt.Errorf("failed to write temporary new executable: %w", err)
		}
		
		Log.Debugf("InstallAndRestart: POSIX scheme - setting executable permission on %s", tempNewFile)
		if err := os.Chmod(tempNewFile, 0755); err != nil {
			_ = os.Remove(tempNewFile)
			Log.Errorf("InstallAndRestart: failed to chmod temp file: %v", err)
			return fmt.Errorf("failed to set executable permission: %w", err)
		}

		Log.Debugf("InstallAndRestart: POSIX scheme - atomically renaming %s to %s", tempNewFile, exePath)
		if err := os.Rename(tempNewFile, exePath); err != nil {
			_ = os.Remove(tempNewFile)
			Log.Errorf("InstallAndRestart: failed to rename temp file: %v", err)
			return fmt.Errorf("failed to rename target executable: %w", err)
		}
	}

	// Clean up update package cache files
	Log.Debugf("InstallAndRestart: cleaning up cached download files")
	_ = os.Remove(pkgPath)
	_ = os.Remove(pkgPath + ".sig")

	// Restart EQT: spawn a new process and exit the current one.
	Log.Debugf("InstallAndRestart: spawning new process and restarting EQT. args: %v", os.Args[1:])
	cmd := exec.Command(exePath, os.Args[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()

	if err := cmd.Start(); err != nil {
		Log.Errorf("InstallAndRestart: failed to spawn new process: %v", err)
		return fmt.Errorf("failed to start new EQT process: %w", err)
	}

	Log.Infof("InstallAndRestart: new process successfully started. Exiting current process now.")
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
		Log.Debugf("CleanLingeringOldExecutables: found lingering old executable %s, attempting deletion...", exeOldPath)
		err = os.Remove(exeOldPath)
		if err == nil {
			Log.Debugf("CleanLingeringOldExecutables: successfully deleted %s", exeOldPath)
		} else {
			Log.Debugf("CleanLingeringOldExecutables: failed to delete %s (process might still be exiting): %v", exeOldPath, err)
		}
	}
}
