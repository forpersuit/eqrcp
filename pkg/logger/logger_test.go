package logger

import (
	"bytes"
	"strings"
	"sync"
	"testing"
)

func TestLoggerFormattingAndLevels(t *testing.T) {
	buf := &bytes.Buffer{}
	l := NewWithWriter(true, buf) // quiet = true, but writes to buf

	l.Infof("info event: %s", "started")
	l.Warnf("warn event: %s", "slow")
	l.Errorf("error event: %s", "failed")
	l.Debugf("debug event: %s", "hidden by default info level")

	output := buf.String()
	if !strings.Contains(output, "[INFO] info event: started") {
		t.Errorf("expected info event in buffer, got: %s", output)
	}
	if !strings.Contains(output, "[WARN] warn event: slow") {
		t.Errorf("expected warn event in buffer, got: %s", output)
	}
	if !strings.Contains(output, "[ERROR] error event: failed") {
		t.Errorf("expected error event in buffer, got: %s", output)
	}
	if strings.Contains(output, "[DEBUG]") {
		t.Errorf("debug should be hidden when default level is LevelInfo, got: %s", output)
	}
}

func TestLoggerPrefixAndTrace(t *testing.T) {
	buf := &bytes.Buffer{}
	l := NewWithWriter(true, buf).WithPrefix("[E2EE]").WithTraceID("tr-9988")

	l.Infof("chunk written chunkIndex=%d", 3)

	output := buf.String()
	if !strings.Contains(output, "[INFO] [tr-9988] [E2EE] chunk written chunkIndex=3") {
		t.Errorf("unexpected formatted output: %s", output)
	}
}

func TestLoggerConcurrentWrites(t *testing.T) {
	buf := &bytes.Buffer{}
	l := NewWithWriter(true, buf)

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			l.Infof("goroutine message %d", idx)
		}(i)
	}
	wg.Wait()

	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 50 {
		t.Errorf("expected exactly 50 log lines, got %d", len(lines))
	}
}
