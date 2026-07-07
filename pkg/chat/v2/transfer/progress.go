package transfer

import (
	"io"
)

// ProgressWriter wraps an io.Writer and intercepts writes to report progress.
type ProgressWriter struct {
	writer     io.Writer
	onProgress func(n int)
}

// NewProgressWriter creates a new ProgressWriter.
func NewProgressWriter(w io.Writer, onProgress func(n int)) *ProgressWriter {
	return &ProgressWriter{
		writer:     w,
		onProgress: onProgress,
	}
}

// Write intercepts the write call, forwards it to the underlying writer, and invokes onProgress.
func (pw *ProgressWriter) Write(p []byte) (int, error) {
	n, err := pw.writer.Write(p)
	if n > 0 && pw.onProgress != nil {
		pw.onProgress(n)
	}
	return n, err
}

// ProgressReader wraps an io.Reader and intercepts reads to report progress.
type ProgressReader struct {
	reader     io.Reader
	onProgress func(n int)
}

// NewProgressReader creates a new ProgressReader.
func NewProgressReader(r io.Reader, onProgress func(n int)) *ProgressReader {
	return &ProgressReader{
		reader:     r,
		onProgress: onProgress,
	}
}

// Read intercepts the read call, forwards it to the underlying reader, and invokes onProgress.
func (pr *ProgressReader) Read(p []byte) (int, error) {
	n, err := pr.reader.Read(p)
	if n > 0 && pr.onProgress != nil {
		pr.onProgress(n)
	}
	return n, err
}
