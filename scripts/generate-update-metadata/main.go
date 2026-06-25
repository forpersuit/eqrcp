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
		fmt.Println("Usage: go run scripts/generate-update-metadata/main.go <version> <out_dir> <output_metadata_path>")
		os.Exit(1)
	}

	version := os.Args[1]
	outDir := os.Args[2]
	outputPath := os.Args[3]

	files, err := os.ReadDir(outDir)
	if err != nil {
		fmt.Printf("Error reading output directory %s: %v\n", outDir, err)
		os.Exit(1)
	}

	var assets []UpdateAsset
	for _, file := range files {
		if file.IsDir() {
			continue
		}
		info, err := file.Info()
		if err != nil {
			fmt.Printf("Error getting file info for %s: %v\n", file.Name(), err)
			continue
		}

		// Download URL will point to Cloudflare Pages static downloads directory
		downloadURL := fmt.Sprintf("https://eqt.net.im/downloads/latest/%s", file.Name())

		assets = append(assets, UpdateAsset{
			Name:        file.Name(),
			DownloadURL: downloadURL,
			Size:        info.Size(),
		})
	}

	response := UpdateResponse{
		Version:     version,
		PublishedAt: time.Now().UTC().Format(time.RFC3339),
		Changelog:   fmt.Sprintf("EQT %s release updates.", version),
		Assets:      assets,
	}

	jsonData, err := json.MarshalIndent(response, "", "  ")
	if err != nil {
		fmt.Printf("Error marshalling json: %v\n", err)
		os.Exit(1)
	}

	// Ensure output directory exists
	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		fmt.Printf("Error creating output directories: %v\n", err)
		os.Exit(1)
	}

	err = os.WriteFile(outputPath, jsonData, 0644)
	if err != nil {
		fmt.Printf("Error writing update-metadata.json to %s: %v\n", outputPath, err)
		os.Exit(1)
	}

	fmt.Printf("Successfully generated update-metadata.json at %s with %d assets.\n", outputPath, len(assets))
}
