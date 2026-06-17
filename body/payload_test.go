package body

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
	if got.Archive {
		t.Fatal("FromArgs() Archive = true, want false")
	}
	if len(got.Items) != 1 || got.Items[0] != "note.txt" {
		t.Fatalf("FromArgs() Items = %#v, want note.txt", got.Items)
	}
}

func TestFromArgsDirectoryZipName(t *testing.T) {
	setZipTimestampForTest(t)
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
	defer func() {
		_ = got.Delete()
	}()

	if got.Filename != "photos-directory-20260422-010203.zip" {
		t.Fatalf("FromArgs() Filename = %q, want %q", got.Filename, "photos-directory-20260422-010203.zip")
	}
	if !got.DeleteAfterTransfer {
		t.Fatal("FromArgs() DeleteAfterTransfer = false, want true")
	}
	if !got.Archive {
		t.Fatal("FromArgs() Archive = false, want true")
	}
	if len(got.Items) != 1 || got.Items[0] != "photos" {
		t.Fatalf("FromArgs() Items = %#v, want photos", got.Items)
	}
}

func TestFromArgsMultipleFilesZipName(t *testing.T) {
	setZipTimestampForTest(t)
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
	defer func() {
		_ = got.Delete()
	}()

	if got.Filename != "eqt-multiple-files-20260422-010203.zip" {
		t.Fatalf("FromArgs() Filename = %q, want %q", got.Filename, "eqt-multiple-files-20260422-010203.zip")
	}
	if !got.DeleteAfterTransfer {
		t.Fatal("FromArgs() DeleteAfterTransfer = false, want true")
	}
	if !got.Archive {
		t.Fatal("FromArgs() Archive = false, want true")
	}
	if strings.Join(got.Items, ",") != "first file.txt,second file.txt" {
		t.Fatalf("FromArgs() Items = %#v", got.Items)
	}
}

func setZipTimestampForTest(t *testing.T) {
	t.Helper()
	previous := zipTimestamp
	zipTimestamp = func() time.Time {
		return time.Date(2026, 4, 22, 1, 2, 3, 0, time.UTC)
	}
	t.Cleanup(func() {
		zipTimestamp = previous
	})
}
