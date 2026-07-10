package diag

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// Level identifies event severity.
type Level string

const (
	LevelDebug Level = "debug"
	LevelInfo  Level = "info"
	LevelWarn  Level = "warn"
	LevelError Level = "error"
)

// Field is a structured diagnostic key/value pair.
type Field struct {
	Key   string
	Value any
}

// F creates a structured diagnostic field.
func F(key string, value any) Field {
	return Field{Key: key, Value: value}
}

// Event is one structured diagnostic record.
type Event struct {
	Time    time.Time
	Level   Level
	Message string
	Fields  []Field
	Err     error
}

// Logger receives structured diagnostic records.
type Logger interface {
	Log(ctx context.Context, event Event)
}

// StdLogger writes readable structured logs to the standard logger.
type StdLogger struct {
	mu  sync.Mutex
	log *log.Logger
}

// NewStdLogger creates a standard diagnostic logger writing to os.Stderr.
func NewStdLogger() *StdLogger {
	return NewStdLoggerWithWriter(os.Stderr)
}

// NewStdLoggerWithWriter creates a standard diagnostic logger writing to custom writer.
func NewStdLoggerWithWriter(w io.Writer) *StdLogger {
	return &StdLogger{log: log.New(w, "chat-v2 ", log.LstdFlags)}
}

func (l *StdLogger) Log(ctx context.Context, event Event) {
	if l == nil {
		return
	}
	if l.log == nil {
		l.log = log.New(os.Stderr, "chat-v2 ", log.LstdFlags)
	}
	if event.Time.IsZero() {
		event.Time = time.Now()
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.log.Printf("%s %s", event.Level, formatEvent(event))
}

// NopLogger discards events.
type NopLogger struct{}

func (NopLogger) Log(context.Context, Event) {}

// MemoryLogger records events for tests.
type MemoryLogger struct {
	mu     sync.Mutex
	events []Event
}

func (l *MemoryLogger) Log(ctx context.Context, event Event) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if event.Time.IsZero() {
		event.Time = time.Now()
	}
	fields := append([]Field(nil), event.Fields...)
	event.Fields = fields
	l.events = append(l.events, event)
}

func (l *MemoryLogger) Events() []Event {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]Event(nil), l.events...)
}

// Emit sends a diagnostic event to logger. Nil loggers are treated as no-op.
func Emit(ctx context.Context, logger Logger, level Level, message string, err error, fields ...Field) {
	if logger == nil {
		return
	}
	logger.Log(ctx, Event{
		Time:    time.Now(),
		Level:   level,
		Message: message,
		Fields:  fields,
		Err:     err,
	})
}

func formatEvent(event Event) string {
	parts := []string{event.Message}
	if event.Err != nil {
		parts = append(parts, "error="+quoteValue(event.Err.Error()))
	}
	if len(event.Fields) > 0 {
		fields := append([]Field(nil), event.Fields...)
		sort.SliceStable(fields, func(i, j int) bool {
			return fields[i].Key < fields[j].Key
		})
		for _, field := range fields {
			if field.Key == "" {
				continue
			}
			parts = append(parts, field.Key+"="+quoteValue(fmt.Sprint(field.Value)))
		}
	}
	return strings.Join(parts, " ")
}

func quoteValue(value string) string {
	if value == "" {
		return `""`
	}
	if strings.ContainsAny(value, " \t\n\r\"") {
		return fmt.Sprintf("%q", value)
	}
	return value
}
