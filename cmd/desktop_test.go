package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"eqt/application"
	"github.com/spf13/cobra"
)

func TestDesktopReceiveOutput(t *testing.T) {
	if output, ok := desktopReceiveOutput(nil); ok || output != "" {
		t.Fatalf("desktopReceiveOutput(nil) = %q, %v; want empty false", output, ok)
	}
	if output, ok := desktopReceiveOutput([]string{"/tmp/recv"}); !ok || output != "/tmp/recv" {
		t.Fatalf("desktopReceiveOutput(path) = %q, %v; want path true", output, ok)
	}
}

func TestDesktopCommandIncludesAgentStart(t *testing.T) {
	for _, command := range desktopCmd.Commands() {
		if command.Name() == "agent-start" {
			return
		}
	}
	t.Fatal("desktop command list missing agent-start")
}

func TestDesktopAgentCommandsIncludeBackgroundFlag(t *testing.T) {
	for _, command := range []*cobra.Command{desktopAgentCmd, desktopAgentStartCmd} {
		flag := command.Flags().Lookup("background")
		if flag == nil {
			t.Fatalf("%s missing background flag", command.Name())
		}
		if flag.Shorthand != "B" {
			t.Fatalf("%s background shorthand = %q, want B", command.Name(), flag.Shorthand)
		}
	}
}

func TestDesktopBrowserPreference(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.yml")
	if err := os.WriteFile(configPath, []byte("browser: false\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if got := desktopBrowserPreference(application.Flags{Config: configPath}, true); got {
		t.Fatal("desktopBrowserPreference() = true, want false from config")
	}
	missingPath := filepath.Join(t.TempDir(), "missing.yml")
	if got := desktopBrowserPreference(application.Flags{Config: missingPath}, false); !got {
		t.Fatal("desktopBrowserPreference() = false, want default true for new config")
	}
}

func TestDesktopOutputPreference(t *testing.T) {
	output := t.TempDir()
	configPath := filepath.Join(t.TempDir(), "config.yml")
	if err := os.WriteFile(configPath, []byte("output: "+output+"\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if got := desktopOutputPreference(application.Flags{Config: configPath}); got != output {
		t.Fatalf("desktopOutputPreference() = %q, want %q", got, output)
	}
	missingPath := filepath.Join(t.TempDir(), "missing.yml")
	if got := desktopOutputPreference(application.Flags{Config: missingPath}); got == "" {
		t.Fatal("desktopOutputPreference() returned empty default")
	}
}
