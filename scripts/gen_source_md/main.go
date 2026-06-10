package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	softwareName   = "EQT Easy QR Transfer 局域网文件传输系统 V1.0.0"
	copyrightOwner = "李跃龙"
	linesPerPage   = 50
	targetLines    = linesPerPage * 30 // 1500 lines for 30 pages
	outputPath     = "软著申请材料/02-源代码鉴别材料-李跃龙.md"
)

type FileInfo struct {
	Path  string
	Lines int
}

func main() {
	var files []FileInfo
	filepath.Walk(".", func(path string, info os.FileInfo, err error) error {
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

	sort.Slice(files, func(i, j int) bool {
		return fileOrder(files[i].Path) < fileOrder(files[j].Path)
	})

	firstLines := extractLines(files, targetLines)
	lastLines := extractLinesReverse(files, targetLines)

	allLines := append(firstLines, lastLines...)

	// Clean and replace names/versions to ensure consistency
	for i, line := range allLines {
		line = strings.ReplaceAll(line, "forpersuit", copyrightOwner)
		line = strings.ReplaceAll(line, "V1.0", "V1.0.0")
		allLines[i] = line
	}

	var mdContent strings.Builder
	mdContent.WriteString(fmt.Sprintf("# %s 源代码鉴别材料\n\n", softwareName))
	mdContent.WriteString(fmt.Sprintf("**软件名称**: EQT Easy QR Transfer 局域网文件传输系统\n"))
	mdContent.WriteString(fmt.Sprintf("**软件版本**: V1.0.0\n"))
	mdContent.WriteString(fmt.Sprintf("**著作权人**: %s\n\n", copyrightOwner))
	mdContent.WriteString("---\n\n")

	for i := 0; i < len(allLines); i += linesPerPage {
		end := i + linesPerPage
		if end > len(allLines) {
			end = len(allLines)
		}
		pageNum := (i / linesPerPage) + 1
		
		mdContent.WriteString(fmt.Sprintf("### %s | 第 %d 页\n\n", softwareName, pageNum))
		mdContent.WriteString("```go\n")
		for _, line := range allLines[i:end] {
			mdContent.WriteString(line + "\n")
		}
		mdContent.WriteString("```\n\n")
		
		// Add page break for PDF exports
		if end < len(allLines) {
			mdContent.WriteString("<div style=\"page-break-after: always;\"></div>\n\n")
		}
	}

	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating output dir: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(outputPath, []byte(mdContent.String()), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing Markdown: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Successfully generated %s (%d pages, %d lines)\n", outputPath, len(allLines)/linesPerPage, len(allLines))
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
		"cmd/eqrcp-launcher/main.go":              25,
		"cmd/eqrcp-launcher/launcher_windows.go":  26,
		"cmd/eqrcp-launcher/launcher_other.go":    27,
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
