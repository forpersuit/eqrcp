// gen-softcopy-pdf generates the source code PDF for software copyright (软著) application.
// Usage: go run scripts/gen-softcopy-pdf.go
// Output: 软著申请材料/EQT-source-code-V1.0.pdf

package main

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	softwareName   = "EQT Easy QR Transfer 局域网文件传输系统 V1.0"
	linesPerPage   = 50
	targetLines    = linesPerPage * 30 // 1500 lines for 30 pages
	outputPath     = "软著申请材料/EQT-source-code-V1.0.pdf"
	pageWidth      = 595.0
	pageHeight     = 842.0
	marginLeft     = 50.0
	marginTop      = 50.0
	headerFontSize = 8.0
	codeFontSize   = 7.0
	lineHeight     = 9.5
	charsPerLine   = 100
)

type FileInfo struct {
	Path  string
	Lines int
}

func main() {
	projectRoot, err := findProjectRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	if err := os.Chdir(projectRoot); err != nil {
		fmt.Fprintf(os.Stderr, "Error changing to project root: %v\n", err)
		os.Exit(1)
	}

	var files []FileInfo
	err = filepath.Walk(".", func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if !isSourceFile(path, info.Name()) {
			return nil
		}
		lines, err := countLines(path)
		if err != nil {
			return nil
		}
		files = append(files, FileInfo{Path: path, Lines: lines})
		return nil
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error walking files: %v\n", err)
		os.Exit(1)
	}

	sort.Slice(files, func(i, j int) bool {
		return fileOrder(files[i].Path) < fileOrder(files[j].Path)
	})

	firstLines := extractLines(files, targetLines)
	lastLines := extractLinesReverse(files, targetLines)

	var pages []string
	allLines := append(firstLines, lastLines...)

	for i := 0; i < len(allLines); i += linesPerPage {
		end := i + linesPerPage
		if end > len(allLines) {
			end = len(allLines)
		}
		pageNum := len(pages) + 1
		pageContent := buildPageContent(allLines[i:end], pageNum)
		pages = append(pages, pageContent)
	}

	pdfData := buildPDF(pages)
	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating output dir: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(outputPath, pdfData, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing PDF: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Generated %s (%d pages total: %d front + %d back, %d lines)\n",
		outputPath, len(pages), len(pages)/2, len(pages)-len(pages)/2, len(allLines))
}

func isSourceFile(path string, name string) bool {
	if strings.Contains(path, "/node_modules/") ||
		strings.Contains(path, "/build/") ||
		strings.Contains(path, "/dist/") ||
		strings.Contains(path, "/wailsjs/") ||
		strings.HasPrefix(path, "scripts/") ||
		strings.Contains(path, "软著申请材料/") {
		return false
	}
	if strings.HasSuffix(name, "_test.go") {
		return false
	}
	for _, ext := range []string{".go", ".js", ".css", ".html"} {
		if strings.HasSuffix(path, ext) {
			return true
		}
	}
	return false
}

func findProjectRoot() (string, error) {
	exe, _ := os.Executable()
	for dir := filepath.Dir(exe); dir != "/" && dir != "."; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
	}
	return os.Getwd()
}

func countLines(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	count := 0
	for scanner.Scan() {
		count++
	}
	return count, scanner.Err()
}

func fileOrder(path string) int {
	order := map[string]int{
		"main.go":                                 0,
		"application/application.go":              1,
		"cmd/qrcp.go":                             10,
		"cmd/send.go":                             11,
		"cmd/receive.go":                          12,
		"cmd/chat.go":                             13,
		"cmd/config.go":                           14,
		"cmd/version.go":                          15,
		"cmd/completion.go":                       16,
		"cmd/desktop.go":                          17,
		"cmd/desktop_agent.go":                    18,
		"cmd/desktop_integration.go":              19,
		"cmd/desktop_agent_background_windows.go": 20,
		"cmd/desktop_agent_background_other.go":   21,
		"cmd/eqt-launcher/main.go":              25,
		"cmd/eqt-launcher/launcher_windows.go":  26,
		"cmd/eqt-launcher/launcher_other.go":    27,
		"config/config.go":                        30,
		"config/settings.go":                      31,
		"config/migrate.go":                       32,
		"config/util.go":                          33,
		"body/payload.go":                         40,
		"server/server.go":                        50,
		"server/chat.go":                          51,
		"server/util.go":                          52,
		"server/tcpkeepalivelistener.go":          53,
		"qr/qr.go":                                60,
		"util/util.go":                            70,
		"util/net.go":                             71,
		"logger/logger.go":                        80,
		"pages/pages.go":                          90,
		"version/version.go":                      100,
		"desktop/gui/main.go":                     110,
		"desktop/gui/app.go":                      111,
		"desktop/gui/tray.go":                     112,
		"desktop/gui/frontend/src/main.js":        120,
		"desktop/gui/frontend/src/app.css":        121,
		"desktop/gui/frontend/src/style.css":      122,
		"pages/chat.tmpl.html":                    130,
		"pages/qr.tmpl.html":                      131,
		"pages/upload.tmpl.html":                  132,
	}
	if o, ok := order[path]; ok {
		return o
	}
	return 1000
}

func readFileLines(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	return lines, scanner.Err()
}

func extractLines(files []FileInfo, target int) []string {
	var result []string
	for _, f := range files {
		if len(result) >= target {
			break
		}
		lines, err := readFileLines(f.Path)
		if err != nil {
			continue
		}
		needed := target - len(result)
		if len(lines) > needed {
			result = append(result, lines[:needed]...)
		} else {
			result = append(result, lines...)
		}
	}
	return result
}

func extractLinesReverse(files []FileInfo, target int) []string {
	var result []string
	for i := len(files) - 1; i >= 0; i-- {
		if len(result) >= target {
			break
		}
		lines, err := readFileLines(files[i].Path)
		if err != nil {
			continue
		}
		needed := target - len(result)
		if len(lines) > needed {
			result = append(append([]string{}, lines[len(lines)-needed:]...), result...)
		} else {
			result = append(append([]string{}, lines...), result...)
		}
	}
	return result
}

func buildPageContent(lines []string, pageNum int) string {
	header := fmt.Sprintf("%s  —  Page %d", softwareName, pageNum)
	codeStartY := pageHeight - marginTop - 14

	var buf bytes.Buffer

	// Code lines
	buf.WriteString("BT\n")
	buf.WriteString(fmt.Sprintf("/F1 %.1f Tf\n", codeFontSize))
	buf.WriteString(fmt.Sprintf("%.1f TL\n", lineHeight))
	for i, line := range lines {
		y := codeStartY - float64(i)*lineHeight
		if y < 40 {
			break
		}
		escaped := escapePDFString(line)
		if len(escaped) > charsPerLine {
			escaped = escaped[:charsPerLine]
		}
		buf.WriteString(fmt.Sprintf("1 0 0 1 %.1f %.1f Tm (%s) Tj\n", marginLeft, y, escaped))
	}
	buf.WriteString("ET\n")

	// Page header
	buf.WriteString("BT\n")
	buf.WriteString(fmt.Sprintf("/F1 %.1f Tf\n", headerFontSize))
	headerY := pageHeight - marginTop + 6
	buf.WriteString(fmt.Sprintf("1 0 0 1 %.1f %.1f Tm (%s) Tj\n", marginLeft, headerY, escapePDFString(header)))
	buf.WriteString("ET\n")

	return buf.String()
}

func escapePDFString(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "(", "\\(")
	s = strings.ReplaceAll(s, ")", "\\)")
	return s
}

// buildPDF generates a PDF 1.4 document using only built-in Courier font.
func buildPDF(pages []string) []byte {
	var buf bytes.Buffer
	var offsets []int

	type pdfObj struct {
		num  int
		data string
	}
	var allObjs []pdfObj
	objNum := 0
	nextObj := func(data string) int {
		objNum++
		allObjs = append(allObjs, pdfObj{objNum, data})
		return objNum
	}

	fontRef := nextObj("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")

	var contentRefs []int
	for _, cs := range pages {
		contentRefs = append(contentRefs, nextObj(
			fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(cs), cs)))
	}

	var pageRefs []int
	for _, cr := range contentRefs {
		pageRefs = append(pageRefs, nextObj(
			fmt.Sprintf("<< /Type /Page /Parent 3 0 R /MediaBox [0 0 %.1f %.1f] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>",
				pageWidth, pageHeight, cr, fontRef)))
	}

	kids := ""
	for _, p := range pageRefs {
		kids += fmt.Sprintf("%d 0 R ", p)
	}
	pagesRef := nextObj(fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", kids, len(pageRefs)))
	catalogRef := nextObj(fmt.Sprintf("<< /Type /Catalog /Pages %d 0 R >>", pagesRef))

	offsets = make([]int, len(allObjs)+1)
	for _, o := range allObjs {
		offsets[o.num] = buf.Len()
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", o.num, o.data)
	}

	xrefOffset := buf.Len()
	buf.WriteString("xref\n")
	fmt.Fprintf(&buf, "0 %d\n", len(offsets))
	buf.WriteString(fmt.Sprintf("%010d %05d f \n", 0, 65535))
	for i := 1; i < len(offsets); i++ {
		fmt.Fprintf(&buf, "%010d %05d n \n", offsets[i], 0)
	}

	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root %d 0 R >>\n", len(offsets), catalogRef)
	buf.WriteString("startxref\n")
	fmt.Fprintf(&buf, "%d\n", xrefOffset)
	buf.WriteString("%%EOF\n")

	header := fmt.Sprintf("%%PDF-1.4\n%%%c%c%c%c\n", 0xE2, 0xE3, 0xCF, 0xD3)
	return append([]byte(header), buf.Bytes()...)
}
