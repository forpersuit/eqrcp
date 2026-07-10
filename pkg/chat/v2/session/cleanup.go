package session

import (
	"eqt/pkg/util"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// UploadRoot returns the directory path reserved for storing EQT Chat uploads.
func UploadRoot() (string, error) {
	dir := filepath.Join(os.TempDir(), "EQT Chat Uploads")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

// CleanupUploads cleans up the temporary files in the EQT Chat Uploads directory.
//  1. Automatically cleans up files modified before today (previous day's data and older).
//  2. If the remaining disk space is insufficient (less than 2GB), cleans up the files
//     by modifying time from oldest to newest (recent files) until free space is at least 2GB.
func CleanupUploads() error {
	root, err := UploadRoot()
	if err != nil {
		return err
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	now := time.Now()
	// Zero time of today
	todayZero := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	// 1. Cleanup files modified before today
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(todayZero) {
			_ = os.Remove(filepath.Join(root, entry.Name()))
		}
	}

	// 2. If disk space is still insufficient (less than 2GB), cleanup remaining files starting from oldest
	free, err := util.GetDiskFreeSpace(root)
	if err == nil && free < 2*1024*1024*1024 {
		// Re-read remaining files after previous cleanup
		entries, err = os.ReadDir(root)
		if err == nil {
			type fileItem struct {
				name string
				t    time.Time
			}
			var files []fileItem
			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}
				info, err := entry.Info()
				if err != nil {
					continue
				}
				files = append(files, fileItem{name: entry.Name(), t: info.ModTime()})
			}

			// Sort by mod time ascending (oldest first, leading up to recent)
			sort.Slice(files, func(i, j int) bool {
				return files[i].t.Before(files[j].t)
			})

			for _, file := range files {
				_ = os.Remove(filepath.Join(root, file.name))
				free, err = util.GetDiskFreeSpace(root)
				if err == nil && free >= 2*1024*1024*1024 {
					break
				}
			}
		}
	}

	return nil
}

// FormatFreeSpace helper formats disk free bytes to a readable string (e.g. "12.3 GB")
func FormatFreeSpace(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}
