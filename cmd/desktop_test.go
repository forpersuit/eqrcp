package cmd

import "testing"

func TestDesktopReceiveOutput(t *testing.T) {
	if output, ok := desktopReceiveOutput(nil); ok || output != "" {
		t.Fatalf("desktopReceiveOutput(nil) = %q, %v; want empty false", output, ok)
	}
	if output, ok := desktopReceiveOutput([]string{"/tmp/recv"}); !ok || output != "/tmp/recv" {
		t.Fatalf("desktopReceiveOutput(path) = %q, %v; want path true", output, ok)
	}
}
