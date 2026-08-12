package server

import (
	"fmt"
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	// Set EQT_TESTING environment variable to disable external network calls during tests
	os.Setenv("EQT_TESTING", "true")

	// Setup isolated temporary config directory for all tests in pkg/server
	tempDir, err := os.MkdirTemp("", "eqt-server-test-config-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create isolated temp test config dir: %v\n", err)
		os.Exit(1)
	}

	os.Setenv("EQT_CONFIG_DIR", tempDir)

	code := m.Run()

	os.RemoveAll(tempDir)
	os.Exit(code)
}
