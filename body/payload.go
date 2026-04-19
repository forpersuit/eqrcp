package body

import (
	"os"
	"path/filepath"
	"strings"

	"eqrcp/util"
)

// Body to transfer
type Body struct {
	Filename            string
	Path                string
	DeleteAfterTransfer bool
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
		file, err := os.Stat(arg)
		if err != nil {
			return Body{}, err
		}
		// If at least one argument is dir, the content will be zipped
		if file.IsDir() {
			shouldzip = true
			hasDir = true
		}
		files = append(files, arg)
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
		content = args[0]
	}
	filename := filepath.Base(content)
	if shouldzip {
		filename = zipDownloadName(args, zipFlag, hasDir)
	}
	return Body{
		Path:                content,
		Filename:            filename,
		DeleteAfterTransfer: shouldzip,
	}, nil
}

func zipDownloadName(args []string, zipFlag bool, hasDir bool) string {
	if len(args) > 1 {
		return "eqrcp-multiple-files.zip"
	}
	base := filepath.Base(args[0])
	if hasDir {
		return strings.TrimSuffix(base, string(filepath.Separator)) + "-directory.zip"
	}
	if zipFlag {
		ext := filepath.Ext(base)
		name := strings.TrimSuffix(base, ext)
		if name == "" {
			name = "eqrcp"
		}
		return name + "-zipped.zip"
	}
	return "eqrcp-files.zip"
}
