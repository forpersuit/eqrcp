package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGenerateMetadata_IncludesSigFilesAndExcludesMetadata(t *testing.T) {
	tempDir := t.TempDir()
	outDir := filepath.Join(tempDir, "out")
	if err := os.MkdirAll(outDir, 0755); err != nil {
		t.Fatalf("failed to create temp outDir: %v", err)
	}

	// Create mock asset files
	filesToCreate := []string{
		"eqt-desktop-test-windows-amd64.zip",
		"eqt-desktop-test-windows-amd64.zip.sig",
		"update-metadata.json", // Should be excluded
	}

	for _, fname := range filesToCreate {
		if err := os.WriteFile(filepath.Join(outDir, fname), []byte("mock-data-for-"+fname), 0644); err != nil {
			t.Fatalf("failed to write mock file %s: %v", fname, err)
		}
	}

	metaOut := filepath.Join(tempDir, "dist", "update-metadata.json")
	resp, err := GenerateMetadata("v1.36.148", outDir, metaOut, "test")
	if err != nil {
		t.Fatalf("GenerateMetadata failed: %v", err)
	}

	if resp.Version != "v1.36.148" {
		t.Errorf("expected version v1.36.148, got %s", resp.Version)
	}

	// Verify assets in memory
	var hasZip, hasSig, hasMeta bool
	for _, asset := range resp.Assets {
		if asset.Name == "eqt-desktop-test-windows-amd64.zip" {
			hasZip = true
			if !strings.Contains(asset.DownloadURL, "?t=") {
				t.Errorf("test channel asset download URL should have timestamp query, got: %s", asset.DownloadURL)
			}
		}
		if asset.Name == "eqt-desktop-test-windows-amd64.zip.sig" {
			hasSig = true
			if !strings.Contains(asset.DownloadURL, "?t=") {
				t.Errorf("test channel sig asset download URL should have timestamp query, got: %s", asset.DownloadURL)
			}
		}
		if asset.Name == "update-metadata.json" {
			hasMeta = true
		}
	}

	if !hasZip {
		t.Errorf("expected .zip asset in metadata assets")
	}
	if !hasSig {
		t.Errorf("DEF-08 regression: expected .sig asset to be preserved in metadata assets")
	}
	if hasMeta {
		t.Errorf("expected update-metadata.json to be excluded from assets")
	}

	// Verify written file
	savedData, err := os.ReadFile(metaOut)
	if err != nil {
		t.Fatalf("failed to read saved metadata: %v", err)
	}
	var parsed UpdateResponse
	if err := json.Unmarshal(savedData, &parsed); err != nil {
		t.Fatalf("failed to parse saved metadata json: %v", err)
	}
	if len(parsed.Assets) != 2 {
		t.Errorf("expected 2 assets in written file, got %d", len(parsed.Assets))
	}
}
