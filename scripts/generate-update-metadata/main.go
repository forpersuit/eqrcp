package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type UpdateAsset struct {
	Name        string `json:"name"`
	DownloadURL string `json:"download_url"`
	Size        int64  `json:"size"`
}

type UpdateResponse struct {
	Version     string        `json:"version"`
	PublishedAt string        `json:"published_at"`
	Changelog   string        `json:"changelog"`
	Assets      []UpdateAsset `json:"assets"`
}

func main() {
	if len(os.Args) < 4 {
		fmt.Println("Usage: go run scripts/generate-update-metadata/main.go <version> <out_dir> <output_metadata_path> [channel]")
		os.Exit(1)
	}

	version := os.Args[1]
	outDir := os.Args[2]
	outputPath := os.Args[3]

	channel := ""
	if len(os.Args) >= 5 {
		channel = os.Args[4]
	} else if envChan := os.Getenv("UPDATE_CHANNEL"); envChan != "" {
		channel = envChan
	}

	resp, err := GenerateMetadata(version, outDir, outputPath, channel)
	if err != nil {
		fmt.Printf("Error generating update-metadata: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Successfully generated update-metadata.json at %s with %d assets.\n", outputPath, len(resp.Assets))
}

// GenerateMetadata builds the update metadata json file containing all package and signature assets.
func GenerateMetadata(version, outDir, outputPath, channel string) (*UpdateResponse, error) {
	files, err := os.ReadDir(outDir)
	if err != nil {
		return nil, fmt.Errorf("reading output directory %s: %w", outDir, err)
	}

	timestamp := time.Now().UTC().Format("200601021504")

	var assets []UpdateAsset
	for _, file := range files {
		if file.IsDir() {
			continue
		}
		// Skip metadata file itself from download asset list (keep .sig files as valid cryptographic assets)
		if file.Name() == "update-metadata.json" {
			continue
		}
		info, err := file.Info()
		if err != nil {
			fmt.Printf("Error getting file info for %s: %v\n", file.Name(), err)
			continue
		}

		var downloadURL string
		if channel == "test" {
			downloadURL = fmt.Sprintf("https://download.eqt.net.im/downloads/test/%s?t=%s", file.Name(), timestamp)
		} else {
			// Download URL will point to Cloudflare R2 downloads directory with version-based path segregation
			downloadURL = fmt.Sprintf("https://download.eqt.net.im/downloads/%s/%s", version, file.Name())
		}

		assets = append(assets, UpdateAsset{
			Name:        file.Name(),
			DownloadURL: downloadURL,
			Size:        info.Size(),
		})
	}

	changelog := fmt.Sprintf("EQT %s release updates.", version)
	if channel == "test" {
		changelog = fmt.Sprintf("EQT %s test release build.", version)
	}

	response := UpdateResponse{
		Version:     version,
		PublishedAt: time.Now().UTC().Format(time.RFC3339),
		Changelog:   changelog,
		Assets:      assets,
	}

	jsonData, err := json.MarshalIndent(response, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshalling json: %w", err)
	}

	// Ensure output directory exists
	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		return nil, fmt.Errorf("creating output directories: %w", err)
	}

	err = os.WriteFile(outputPath, jsonData, 0644)
	if err != nil {
		return nil, fmt.Errorf("writing update-metadata.json to %s: %w", outputPath, err)
	}

	return &response, nil
}
