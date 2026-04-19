package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetFileName(t *testing.T) {
	existing := []string{"report.txt", "report(1).txt"}

	got := getFileName("report.txt", existing)
	if got != "report(2).txt" {
		t.Fatalf("getFileName() = %q, want %q", got, "report(2).txt")
	}
}

func TestCreateUniqueFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "photo.jpg"), []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}

	out, name, err := createUniqueFile(dir, "photo.jpg", []string{"photo.jpg"})
	if err != nil {
		t.Fatalf("createUniqueFile() error = %v", err)
	}
	defer out.Close()

	if name != "photo(1).jpg" {
		t.Fatalf("createUniqueFile() name = %q, want %q", name, "photo(1).jpg")
	}
	if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
		t.Fatalf("created file missing: %v", err)
	}
}
