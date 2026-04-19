package util

import (
	"regexp"
	"testing"
)

func TestGetRandomURLPath(t *testing.T) {
	first, err := GetRandomURLPath()
	if err != nil {
		t.Fatalf("GetRandomURLPath() error = %v", err)
	}
	second, err := GetRandomURLPath()
	if err != nil {
		t.Fatalf("GetRandomURLPath() error = %v", err)
	}
	if first == second {
		t.Fatal("GetRandomURLPath() returned the same value twice")
	}
	if len(first) < 20 {
		t.Fatalf("GetRandomURLPath() length = %d, want at least 20", len(first))
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(first) {
		t.Fatalf("GetRandomURLPath() = %q, want URL-safe characters only", first)
	}
}
