package body

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"eqt/pkg/util"
)

// Body to transfer
type Body struct {
	Filename            string
	Path                string
	DeleteAfterTransfer bool
	Archive             bool
	Items               []string
	Paths               []string
}

var zipTimestamp = func() time.Time {
	return time.Now()
}

// Delete the payload from disk
func (p Body) Delete() error {
	return os.RemoveAll(p.Path)
}

// FromArgs returns a payload from args
func FromArgs(args []string, zipFlag bool) (Body, error) {
	shouldzip := len(args) > 1 || zipFlag
	var files []string
	hasDir := false
	// Check if content exists
	for _, arg := range args {
		absPath, err := filepath.Abs(arg)
		if err != nil {
			absPath = arg
		}
		file, err := os.Stat(absPath)
		if err != nil {
			return Body{}, err
		}
		// If at least one argument is dir, the content will be zipped
		if file.IsDir() {
			shouldzip = true
			hasDir = true
		}
		files = append(files, absPath)
	}
	// Prepare the content
	// TODO: Research cleaner code
	var content string
	if shouldzip {
		zip, err := util.ZipFiles(files)
		if err != nil {
			return Body{}, err
		}
		content = zip
	} else {
		content = files[0]
	}
	filename := filepath.Base(content)
	if shouldzip {
		filename = zipDownloadName(args, zipFlag, hasDir)
	}
	return Body{
		Path:                content,
		Filename:            filename,
		DeleteAfterTransfer: shouldzip,
		Archive:             shouldzip,
		Items:               displayItems(args),
		Paths:               files,
	}, nil
}

func zipDownloadName(args []string, zipFlag bool, hasDir bool) string {
	timestamp := zipTimestamp().Format("20060102-150405")
	if len(args) > 1 {
		return "eqt-multiple-files-" + timestamp + ".zip"
	}
	base := filepath.Base(args[0])
	if hasDir {
		return strings.TrimSuffix(base, string(filepath.Separator)) + "-directory-" + timestamp + ".zip"
	}
	if zipFlag {
		ext := filepath.Ext(base)
		name := strings.TrimSuffix(base, ext)
		if name == "" {
			name = "eqt"
		}
		return name + "-zipped-" + timestamp + ".zip"
	}
	return "eqt-files-" + timestamp + ".zip"
}

func displayItems(args []string) []string {
	items := make([]string, 0, len(args))
	for _, arg := range args {
		items = append(items, filepath.Base(arg))
	}
	return items
}
