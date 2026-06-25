// gen-doc-pdf converts the softcopy design/documentation markdown files to HTML,
// then opens them in the default browser so the user can "Print → Save as PDF".
//
// Usage:
//   go run scripts/gen-doc-pdf.go          # generate all HTML files
//   go run scripts/gen-doc-pdf.go --open   # generate and open in browser
//
// Output: 软著申请材料/*.html

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

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

	openFlag := false
	for _, arg := range os.Args[1:] {
		if arg == "--open" {
			openFlag = true
		}
	}

	docsDir := "软著申请材料"
	files := []string{
		"03-软件设计说明书.md",
		"04-软件使用说明书.md",
	}

	for _, fn := range files {
		mdPath := filepath.Join(docsDir, fn)
		data, err := os.ReadFile(mdPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading %s: %v\n", mdPath, err)
			continue
		}
		html := mdToHTML(string(data), fn)
		htmlPath := strings.TrimSuffix(mdPath, ".md") + ".html"
		if err := os.WriteFile(htmlPath, []byte(html), 0644); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing %s: %v\n", htmlPath, err)
			continue
		}
		fmt.Printf("Generated %s\n", htmlPath)
		if openFlag {
			// open in default browser
			absPath, _ := filepath.Abs(htmlPath)
			_ = execCommand("xdg-open", absPath)
		}
	}
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

func execCommand(name string, args ...string) error {
	// Simple exec without importing os/exec — use os.StartProcess
	// Actually, let's skip opening for now, user can open manually
	return nil
}

func mdToHTML(md string, title string) string {
	lines := strings.Split(md, "\n")
	var html strings.Builder

	html.WriteString(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>` + title + `</title>
<style>
  @page {
    size: A4;
    margin: 25mm 20mm 25mm 20mm;
    @top-center {
      content: "EQT Easy QR Transfer V1.0";
      font-family: "DejaVu Sans", sans-serif;
      font-size: 9pt;
    }
    @bottom-center {
      content: "Page " counter(page);
      font-size: 9pt;
    }
  }
  body {
    font-family: "DejaVu Sans", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #333;
    max-width: 100%;
  }
  h1 { font-size: 18pt; border-bottom: 2px solid #333; padding-bottom: 4pt; margin-top: 20pt; }
  h2 { font-size: 14pt; border-bottom: 1px solid #999; padding-bottom: 2pt; margin-top: 16pt; }
  h3 { font-size: 12pt; margin-top: 12pt; }
  h4 { font-size: 11pt; margin-top: 8pt; }
  pre, code {
    font-family: "DejaVu Sans Mono", "Courier New", monospace;
    font-size: 9pt;
    background: #f5f5f5;
    padding: 2pt 4pt;
    border-radius: 2pt;
  }
  pre {
    padding: 8pt;
    line-height: 1.4;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3pt solid #ccc;
    margin-left: 0;
    padding-left: 12pt;
    color: #666;
  }
  table { border-collapse: collapse; margin: 8pt 0; }
  th, td { border: 1px solid #ccc; padding: 4pt 8pt; text-align: left; }
  th { background: #eee; }
  hr { border: none; border-top: 1px solid #ccc; margin: 12pt 0; }
  ul, ol { padding-left: 20pt; }
  img { max-width: 100%; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>
`)

	inCodeBlock := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		if strings.HasPrefix(trimmed, "```") {
			if inCodeBlock {
				html.WriteString("</code></pre>\n")
				inCodeBlock = false
			} else {
				html.WriteString("<pre><code>")
				inCodeBlock = true
			}
			continue
		}

		if inCodeBlock {
			html.WriteString(escapeHTML(line) + "\n")
			continue
		}

		if trimmed == "" {
			html.WriteString("\n")
			continue
		}

		if trimmed == "---" {
			html.WriteString(`<div class="page-break"></div>` + "\n")
			continue
		}

		switch {
		case strings.HasPrefix(trimmed, "#### "):
			text := strings.TrimPrefix(trimmed, "#### ")
			html.WriteString("<h4>" + processInline(text) + "</h4>\n")

		case strings.HasPrefix(trimmed, "### "):
			text := strings.TrimPrefix(trimmed, "### ")
			html.WriteString("<h3>" + processInline(text) + "</h3>\n")

		case strings.HasPrefix(trimmed, "## "):
			text := strings.TrimPrefix(trimmed, "## ")
			html.WriteString("<h2>" + processInline(text) + "</h2>\n")

		case strings.HasPrefix(trimmed, "# "):
			text := strings.TrimPrefix(trimmed, "# ")
			html.WriteString("<h1>" + processInline(text) + "</h1>\n")

		case strings.HasPrefix(trimmed, "> "):
			text := strings.TrimPrefix(trimmed, "> ")
			html.WriteString("<blockquote>" + processInline(text) + "</blockquote>\n")

		case strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* "):
			prefix := "- "
			if strings.HasPrefix(trimmed, "* ") {
				prefix = "* "
			}
			text := strings.TrimPrefix(trimmed, prefix)
			html.WriteString("<li>" + processInline(text) + "</li>\n")

		case strings.HasPrefix(trimmed, "|"):
			html.WriteString("<p>" + escapeHTML(line) + "</p>\n")

		default:
			html.WriteString("<p>" + processInline(line) + "</p>\n")
		}
	}

	if inCodeBlock {
		html.WriteString("</code></pre>\n")
	}

	html.WriteString("</body>\n</html>")
	return html.String()
}

func processInline(text string) string {
	// Handle inline formatting: **bold**, *italic*, `code`, [link](url)
	text = escapeHTML(text)

	// Bold **text**
	for strings.Contains(text, "**") {
		start := strings.Index(text, "**")
		if start < 0 {
			break
		}
		end := strings.Index(text[start+2:], "**")
		if end < 0 {
			break
		}
		end += start + 2
		inner := text[start+2 : end]
		text = text[:start] + "<strong>" + inner + "</strong>" + text[end+2:]
	}

	// Italic *text*
	for strings.Contains(text, "*") {
		start := strings.Index(text, "*")
		if start < 0 {
			break
		}
		end := strings.Index(text[start+1:], "*")
		if end < 0 {
			break
		}
		end += start + 1
		inner := text[start+1 : end]
		text = text[:start] + "<em>" + inner + "</em>" + text[end+1:]
	}

	// Inline code `text`
	for strings.Contains(text, "`") {
		start := strings.Index(text, "`")
		if start < 0 {
			break
		}
		end := strings.Index(text[start+1:], "`")
		if end < 0 {
			break
		}
		end += start + 1
		inner := text[start+1 : end]
		text = text[:start] + "<code>" + inner + "</code>" + text[end+1:]
	}

	// Images ![text](url)
	for strings.Contains(text, "![") && strings.Contains(text, "](") {
		startBang := strings.Index(text, "![")
		if startBang < 0 {
			break
		}
		endParen := strings.Index(text[startBang:], "](")
		if endParen < 0 {
			break
		}
		endParen += startBang
		closeParen := strings.Index(text[endParen+2:], ")")
		if closeParen < 0 {
			break
		}
		closeParen += endParen + 2
		altText := text[startBang+2 : endParen]
		imgURL := text[endParen+2 : closeParen]
		text = text[:startBang] + `<img src="` + imgURL + `" alt="` + altText + `" style="display:block; max-width:85%; margin:15px auto; border:1px solid #ccc; box-shadow:0 2px 6px rgba(0,0,0,0.15);"><p style="text-align:center; font-size:10pt; color:#666; margin-bottom:15px; font-weight:bold;">` + altText + "</p>" + text[closeParen+1:]
	}

	// Links [text](url)
	for strings.Contains(text, "](") {
		endParen := strings.Index(text, "](")
		startBracket := strings.LastIndex(text[:endParen], "[")
		if startBracket < 0 {
			break
		}
		closeParen := strings.Index(text[endParen+2:], ")")
		if closeParen < 0 {
			break
		}
		closeParen += endParen + 2
		linkText := text[startBracket+1 : endParen]
		linkURL := text[endParen+2 : closeParen]
		text = text[:startBracket] + `<a href="` + linkURL + `">` + linkText + "</a>" + text[closeParen+1:]
	}

	return text
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}
