package version

import "testing"

func TestDisplayVersionUsesBuildDateForDevBuilds(t *testing.T) {
	previousVersion := version
	t.Cleanup(func() {
		version = previousVersion
	})
	version = "dev"

	got := displayVersion("2026-04-24T01:30:45Z")
	want := "dev-20260424T013045Z"
	if got != want {
		t.Fatalf("displayVersion() = %q, want %q", got, want)
	}
}

func TestDisplayVersionKeepsExplicitReleaseVersion(t *testing.T) {
	previousVersion := version
	t.Cleanup(func() {
		version = previousVersion
	})
	version = "1.2.3"

	if got := displayVersion("2026-04-24T01:30:45Z"); got != "1.2.3" {
		t.Fatalf("displayVersion() = %q, want explicit version", got)
	}
}

func TestIsNewerVersion(t *testing.T) {
	tests := []struct {
		current string
		target  string
		want    bool
	}{
		{"dev", "v1.0.0", true},
		{"dev", "dev", false},
		{"v1.0.0", "dev", false},
		{"v1.0.0", "v1.0.0", false},
		{"v1.0.0", "v1.0.1", true},
		{"v1.0.0", "v1.1.0", true},
		{"v1.0.0", "v2.0.0", true},
		{"v1.0.1", "v1.0.0", false},
		{"v1.1.0", "v1.0.0", false},
		{"v2.0.0", "v1.0.0", false},
		{"1.0.0", "v1.0.1", true},
		{"v1.0.0", "1.0.1", true},
		{"v1.3.0-beta", "v1.3.0", true},
		{"v1.3.0", "v1.3.0-beta", false},
		{"v1.3.0-beta", "v1.3.0-alpha", false},
		{"v1.3.0-alpha", "v1.3.0-beta", true},
		{"v1.3.0-beta1", "v1.3.0-beta2", true},
	}

	for _, tt := range tests {
		got := IsNewerVersion(tt.current, tt.target)
		if got != tt.want {
			t.Errorf("IsNewerVersion(%q, %q) = %v; want %v", tt.current, tt.target, got, tt.want)
		}
	}
}
