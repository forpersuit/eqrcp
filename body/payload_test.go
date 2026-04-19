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
