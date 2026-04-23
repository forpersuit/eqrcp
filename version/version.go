package version

import (
	"fmt"
	"os"
	"time"
)

var (
	app     = "eqrcp"
	version = "dev"
	date    = "n/a"
)

// String returns a string representation of the build.
func String() string {
	return fmt.Sprintf("%s %s [date: %s]", app, version, buildDate())
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
