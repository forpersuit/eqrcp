package logger

import (
	"fmt"
	"io"
	"time"
)

// Print prints its argument if the --quiet flag is not passed
func (l Logger) Print(args ...interface{}) {
	if !l.quiet {
		fmt.Println(args...)
	}
	if l.w != nil {
		timestamp := time.Now().Format("2006-01-02 15:04:05.000")
		_, _ = fmt.Fprint(l.w, fmt.Sprintf("[%s] [PRINT] %s\n", timestamp, fmt.Sprint(args...)))
	}
}

// Printf prints formatted output if the --quiet flag is not passed
func (l Logger) Printf(format string, args ...interface{}) {
	if !l.quiet {
		fmt.Printf(format, args...)
	}
	if l.w != nil {
		timestamp := time.Now().Format("2006-01-02 15:04:05.000")
		_, _ = fmt.Fprint(l.w, fmt.Sprintf("[%s] [PRINT] %s\n", timestamp, fmt.Sprintf(format, args...)))
	}
}

// Infof prints formatted info log with timestamp if --quiet is not passed
func (l Logger) Infof(format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	msg := fmt.Sprintf(format, args...)
	if !l.quiet {
		fmt.Printf("[%s] [INFO] %s\n", timestamp, msg)
	}
	if l.w != nil {
		_, _ = fmt.Fprint(l.w, fmt.Sprintf("[%s] [INFO] %s\n", timestamp, msg))
	}
}

// Errorf prints formatted error log with timestamp if --quiet is not passed
func (l Logger) Errorf(format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	msg := fmt.Sprintf(format, args...)
	if !l.quiet {
		fmt.Printf("[%s] [ERROR] %s\n", timestamp, msg)
	}
	if l.w != nil {
		_, _ = fmt.Fprint(l.w, fmt.Sprintf("[%s] [ERROR] %s\n", timestamp, msg))
	}
}

// Debugf prints formatted debug log with timestamp if --quiet is not passed
func (l Logger) Debugf(format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	msg := fmt.Sprintf(format, args...)
	if !l.quiet {
		fmt.Printf("[%s] [DEBUG] %s\n", timestamp, msg)
	}
	if l.w != nil {
		_, _ = fmt.Fprint(l.w, fmt.Sprintf("[%s] [DEBUG] %s\n", timestamp, msg))
	}
}

// Logger struct
type Logger struct {
	quiet bool
	w     io.Writer
}

// New logger
func New(quiet bool) Logger {
	return Logger{
		quiet: quiet,
	}
}

// NewWithWriter creates a logger with a custom writer
func NewWithWriter(quiet bool, w io.Writer) Logger {
	return Logger{
		quiet: quiet,
		w:     w,
	}
}

