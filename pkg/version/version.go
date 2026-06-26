package version

import (
	"fmt"
	"os"
	"strings"
	"time"
)

var (
	app     = "eqt"
	version = "v1.7.27"
	date    = "n/a"
)

// String returns a string representation of the build.
func String() string {
	date := buildDate()
	return fmt.Sprintf("%s %s [date: %s]", app, displayVersion(date), date)
}

func displayVersion(buildDate string) string {
	if version != "dev" {
		return version
	}
	token := compactBuildDate(buildDate)
	if token == "" {
		return version
	}
	return version + "-" + token
}

func compactBuildDate(value string) string {
	if value == "" || value == "n/a" {
		return ""
	}
	buffer := make([]byte, 0, len(value))
	for index := 0; index < len(value); index++ {
		ch := value[index]
		if (ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') {
			buffer = append(buffer, ch)
		}
	}
	return string(buffer)
}

func buildDate() string {
	if date != "" && date != "n/a" {
		return date
	}
	exe, err := os.Executable()
	if err != nil {
		return date
	}
	info, err := os.Stat(exe)
	if err != nil {
		return date
	}
	return info.ModTime().Format(time.RFC3339Nano)
}

// Version returns the raw version string (e.g. "dev" or "v1.2.3").
func Version() string {
	return version
}

// IsNewerVersion returns true if target version is newer than current version.
// It supports basic semantic versioning (e.g., v1.2.3 or 1.2.3).
// If current is "dev", target is considered newer as long as target is not "dev".
func IsNewerVersion(current, target string) bool {
	cNorm := normalizeVersion(current)
	tNorm := normalizeVersion(target)

	if cNorm == tNorm {
		return false
	}
	if cNorm == "dev" {
		return tNorm != "dev"
	}
	if tNorm == "dev" {
		return false
	}

	// Split main version and pre-release suffix
	currMain, currPre := splitPreRelease(cNorm)
	targMain, targPre := splitPreRelease(tNorm)

	currParts := parseVersionParts(currMain)
	targParts := parseVersionParts(targMain)

	for i := 0; i < 3; i++ {
		cVal := 0
		if i < len(currParts) {
			cVal = currParts[i]
		}
		tVal := 0
		if i < len(targParts) {
			tVal = targParts[i]
		}
		if tVal > cVal {
			return true
		}
		if cVal > tVal {
			return false
		}
	}

	// If main versions are equal:
	// A release version (no pre-release) is newer than a pre-release version.
	// e.g. 1.3.0 > 1.3.0-beta
	if currPre == "" && targPre != "" {
		return false
	}
	if currPre != "" && targPre == "" {
		return true
	}
	if currPre != "" && targPre != "" {
		return targPre > currPre
	}

	return false
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	v = strings.TrimPrefix(v, "V")
	return v
}

func splitPreRelease(v string) (string, string) {
	idx := strings.Index(v, "-")
	if idx != -1 {
		return v[:idx], v[idx+1:]
	}
	return v, ""
}

func parseVersionParts(v string) []int {
	parts := strings.Split(v, ".")
	res := make([]int, 0, len(parts))
	for _, p := range parts {
		var val int
		_, _ = fmt.Sscanf(p, "%d", &val)
		res = append(res, val)
	}
	return res
}

