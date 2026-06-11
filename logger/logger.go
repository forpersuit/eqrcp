package logger

import (
	"fmt"
	"time"
)

// Print prints its argument if the --quiet flag is not passed
func (l Logger) Print(args ...interface{}) {
	if !l.quiet {
		fmt.Println(args...)
	}
}

// Printf prints formatted output if the --quiet flag is not passed
func (l Logger) Printf(format string, args ...interface{}) {
	if !l.quiet {
		fmt.Printf(format, args...)
	}
}

// Infof prints formatted info log with timestamp if --quiet is not passed
func (l Logger) Infof(format string, args ...interface{}) {
	if !l.quiet {
		timestamp := time.Now().Format("2006-01-02 15:04:05.000")
		fmt.Printf("[%s] [INFO] %s\n", timestamp, fmt.Sprintf(format, args...))
	}
}

// Errorf prints formatted error log with timestamp if --quiet is not passed
func (l Logger) Errorf(format string, args ...interface{}) {
	if !l.quiet {
		timestamp := time.Now().Format("2006-01-02 15:04:05.000")
		fmt.Printf("[%s] [ERROR] %s\n", timestamp, fmt.Sprintf(format, args...))
	}
}

// Debugf prints formatted debug log with timestamp if --quiet is not passed
func (l Logger) Debugf(format string, args ...interface{}) {
	if !l.quiet {
		timestamp := time.Now().Format("2006-01-02 15:04:05.000")
		fmt.Printf("[%s] [DEBUG] %s\n", timestamp, fmt.Sprintf(format, args...))
	}
}

// Logger struct
type Logger struct {
	quiet bool
}

// New logger
func New(quiet bool) Logger {
	return Logger{
		quiet: quiet,
	}
}

