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
