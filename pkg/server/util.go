package server

import (
	"fmt"
	"html/template"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
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
	return contentDispositionFor("attachment", filename)
}

func sanitizeASCIIFilename(filename string) string {
	isPureASCII := true
	for i := 0; i < len(filename); i++ {
		if filename[i] > 127 || filename[i] < 32 {
			isPureASCII = false
			break
		}
	}
	if isPureASCII {
		return filename
	}

	ext := filepath.Ext(filename)
	cleanExt := ""
	extIsASCII := true
	for i := 0; i < len(ext); i++ {
		if ext[i] > 127 || ext[i] < 32 {
			extIsASCII = false
			break
		}
	}
	if extIsASCII {
		cleanExt = ext
	}

	base := strings.TrimSuffix(filename, ext)
	var cleanBase strings.Builder
	for i := 0; i < len(base); i++ {
		b := base[i]
		if (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '-' || b == '_' || b == '.' {
			cleanBase.WriteByte(b)
		} else if b <= 127 && b >= 32 {
			cleanBase.WriteByte('_')
		}
	}
	res := strings.Trim(cleanBase.String(), "_")
	if res == "" {
		res = "file"
	}
	return res + cleanExt
}

func rfc5987PercentEncode(s string) string {
	var buf strings.Builder
	for i := 0; i < len(s); i++ {
		b := s[i]
		if (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') ||
			b == '!' || b == '#' || b == '$' || b == '&' || b == '+' || b == '-' ||
			b == '.' || b == '^' || b == '_' || b == '`' || b == '|' || b == '~' {
			buf.WriteByte(b)
		} else {
			fmt.Fprintf(&buf, "%%%02X", b)
		}
	}
	return buf.String()
}

func contentDispositionFor(disposition string, filename string) string {
	if disposition == "" {
		disposition = "attachment"
	}
	asciiName := sanitizeASCIIFilename(filename)
	quoted := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(asciiName)
	return fmt.Sprintf(
		`%s; filename="%s"; filename*=UTF-8''%s`,
		disposition,
		quoted,
		rfc5987PercentEncode(filename),
	)
}

func sendTitle(filename string) string {
	switch {
	case (strings.HasPrefix(filename, "EQT_SHARE_") || strings.HasPrefix(filename, "eqt-multiple-files-")) && strings.HasSuffix(filename, ".zip"):
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

func transferIncomplete(done int64, total int64) bool {
	return total > 0 && done < total
}

func agentStatusFromRepeatRoute(route string) (string, string, bool) {
	parsed, err := url.Parse(route)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", "", false
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "tasks" || parts[2] != "repeat" {
		return "", "", false
	}
	if _, err := strconv.Atoi(parts[1]); err != nil {
		return "", "", false
	}
	return parsed.Scheme + "://" + parsed.Host + "/status", parts[1], true
}

func transferHost(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return parsed.Host
}

type progressResponseWriter struct {
	http.ResponseWriter
	err     error
	onWrite func(int64)
}

func (w *progressResponseWriter) Write(data []byte) (int, error) {
	n, err := w.ResponseWriter.Write(data)
	if err != nil {
		w.err = err
	}
	if n > 0 && w.onWrite != nil {
		w.onWrite(int64(n))
	}
	return n, err
}

func (w *progressResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *progressResponseWriter) ReadFrom(r io.Reader) (n int64, err error) {
	buf := make([]byte, 256*1024)
	for {
		nr, er := r.Read(buf)
		if nr > 0 {
			nw, ew := w.Write(buf[0:nr])
			if nw > 0 {
				n += int64(nw)
			}
			if ew != nil {
				err = ew
				break
			}
			if nr != nw {
				err = io.ErrShortWrite
				break
			}
		}
		if er != nil {
			if er != io.EOF {
				err = er
			}
			break
		}
	}
	return n, err
}
