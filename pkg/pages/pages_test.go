package pages

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"testing"
)

// TestTemplateJavaScriptSyntax validates all inline <script> tags inside HTML templates
// by running node VM compilation to ensure 0 syntax errors.
func TestTemplateJavaScriptSyntax(t *testing.T) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not found in PATH, skipping JS syntax validation")
	}

	templates := map[string]string{
		"qr.tmpl.html":       QR,
		"upload.tmpl.html":   Upload,
		"done.tmpl.html":     Done,
		"download.tmpl.html": Download,
	}

	scriptRegex := regexp.MustCompile(`(?is)<script([^>]*)>(.*?)</script>`)
	rangeRegex := regexp.MustCompile(`\{\{\s*range[\s\S]*?\}\}`)
	ifRegex := regexp.MustCompile(`\{\{\s*if[\s\S]*?\}\}`)
	elseRegex := regexp.MustCompile(`\{\{\s*else[\s\S]*?\}\}`)
	endRegex := regexp.MustCompile(`\{\{\s*end\s*\}\}`)
	strDblRegex := regexp.MustCompile(`"\{\{[^}]*\}\}"`)
	strSglRegex := regexp.MustCompile(`'\{\{[^}]*\}\}'`)
	varRegex := regexp.MustCompile(`\{\{[^}]*\}\}`)

	for name, content := range templates {
		matches := scriptRegex.FindAllStringSubmatch(content, -1)
		for idx, m := range matches {
			if len(m) < 3 {
				continue
			}
			attrs := m[1]
			if strings.Contains(strings.ToLower(attrs), "src=") {
				continue
			}
			code := m[2]
			// Sanitize Go template directives into valid JS
			code = rangeRegex.ReplaceAllString(code, "/* range */")
			code = ifRegex.ReplaceAllString(code, "/* if */")
			code = elseRegex.ReplaceAllString(code, "/* else */")
			code = endRegex.ReplaceAllString(code, "/* end */")
			code = strDblRegex.ReplaceAllString(code, `""`)
			code = strSglRegex.ReplaceAllString(code, `''`)
			code = varRegex.ReplaceAllString(code, "0")

			b64 := base64.StdEncoding.EncodeToString([]byte(code))
			jsRunner := fmt.Sprintf(`
const vm = require('vm');
const code = Buffer.from('%s', 'base64').toString('utf8');
try {
	new vm.Script(code, { filename: '%s' });
	process.exit(0);
} catch (e) {
	console.error(e.message);
	process.exit(1);
}
`, b64, fmt.Sprintf("%s_script_%d.js", name, idx+1))

			cmd := exec.Command(nodePath)
			cmd.Stdin = bytes.NewReader([]byte(jsRunner))
			var out bytes.Buffer
			cmd.Stdout = &out
			cmd.Stderr = &out
			if err := cmd.Run(); err != nil {
				t.Fatalf("Template %s script %d has JS SyntaxError: %v\nOutput: %s", name, idx+1, err, out.String())
			}
		}
	}
}
