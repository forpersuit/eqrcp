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
