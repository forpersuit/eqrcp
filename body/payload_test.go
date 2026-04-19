package body

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFromArgsSingleFile(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "note.txt")
	if err := os.WriteFile(file, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	got, err := FromArgs([]string{file}, false)
	if err != nil {
		t.Fatalf("FromArgs() error = %v", err)
	}
	if got.Path != file {
		t.Fatalf("FromArgs() Path = %q, want %q", got.Path, file)
	}
	if got.Filename != "note.txt" {
		t.Fatalf("FromArgs() Filename = %q, want %q", got.Filename, "note.txt")
	}
	if got.DeleteAfterTransfer {
		t.Fatal("FromArgs() DeleteAfterTransfer = true, want false")
	}
}

func TestFromArgsDirectoryZipName(t *testing.T) {
	dir := t.TempDir()
	nested := filepath.Join(dir, "photos")
	if err := os.Mkdir(nested, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "a.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	got, err := FromArgs([]string{nested}, false)
	if err != nil {
		t.Fatalf("FromArgs() error = %v", err)
	}
	defer got.Delete()

	if got.Filename != "photos-directory.zip" {
		t.Fatalf("FromArgs() Filename = %q, want %q", got.Filename, "photos-directory.zip")
	}
	if !got.DeleteAfterTransfer {
		t.Fatal("FromArgs() DeleteAfterTransfer = false, want true")
	}
}

func TestFromArgsMultipleFilesZipName(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "first file.txt")
	second := filepath.Join(dir, "second file.txt")
	if err := os.WriteFile(first, []byte("first"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(second, []byte("second"), 0644); err != nil {
		t.Fatal(err)
	}

	got, err := FromArgs([]string{first, second}, false)
	if err != nil {
		t.Fatalf("FromArgs() error = %v", err)
	}
	defer got.Delete()

	if got.Filename != "eqrcp-multiple-files.zip" {
		t.Fatalf("FromArgs() Filename = %q, want %q", got.Filename, "eqrcp-multiple-files.zip")
	}
	if !got.DeleteAfterTransfer {
		t.Fatal("FromArgs() DeleteAfterTransfer = false, want true")
	}
}
