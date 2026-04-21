package server

import (
	"fmt"
	"html/template"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func serveTemplate(name string, tmpl string, w io.Writer, data interface{}) error {
	t, err := template.New(name).Parse(tmpl)
	if err != nil {
		return err
	}
	if err := t.Execute(w, data); err != nil {
		return err
	}
	return nil
}

// getFileName generates a file name based on the existing files in the directory
// if name isn't taken leave it unchanged
// else change name to format "name(number).ext"
func getFileName(newFilename string, fileNamesInTargetDir []string) string {
	fileExt := filepath.Ext(newFilename)
	fileName := strings.TrimSuffix(newFilename, fileExt)
	number := 1
	i := 0
	for i < len(fileNamesInTargetDir) {
		if newFilename == fileNamesInTargetDir[i] {
			newFilename = fmt.Sprintf("%s(%v)%s", fileName, number, fileExt)
			number++
			i = 0
		}
		i++
	}
	return newFilename
}

func createUniqueFile(dir string, newFilename string, fileNamesInTargetDir []string) (*os.File, string, error) {
	for {
		fileName := getFileName(newFilename, fileNamesInTargetDir)
		out, err := os.OpenFile(filepath.Join(dir, fileName), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
		if err == nil {
			return out, fileName, nil
		}
		if !os.IsExist(err) {
			return nil, "", err
		}
		fileNamesInTargetDir = append(fileNamesInTargetDir, fileName)
	}
}

func contentDisposition(filename string) string {
	quoted := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(filename)
	return fmt.Sprintf(
		`attachment; filename="%s"; filename*=UTF-8''%s`,
		quoted,
		url.PathEscape(filename),
	)
}

func sendTitle(filename string) string {
	switch {
	case strings.HasPrefix(filename, "eqrcp-multiple-files-") && strings.HasSuffix(filename, ".zip"):
		return "Share multiple files"
	case strings.Contains(filename, "-directory-") && strings.HasSuffix(filename, ".zip"):
		return "Share directory"
	default:
		return "Share file"
	}
}

func transferPercent(done int64, total int64) int {
	if total <= 0 || done <= 0 {
		return 0
	}
	if done >= total {
		return 100
	}
	return int(done * 100 / total)
}

type progressResponseWriter struct {
	http.ResponseWriter
	onWrite func(int64)
}

func (w *progressResponseWriter) Write(data []byte) (int, error) {
	n, err := w.ResponseWriter.Write(data)
	if n > 0 && w.onWrite != nil {
		w.onWrite(int64(n))
	}
	return n, err
}
