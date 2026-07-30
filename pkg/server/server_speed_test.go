package server

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"
)

type noReaderFromResponseWriter struct {
	http.ResponseWriter
	onWrite func(int64)
}

func (w *noReaderFromResponseWriter) Write(b []byte) (int, error) {
	n, err := w.ResponseWriter.Write(b)
	if n > 0 && w.onWrite != nil {
		w.onWrite(int64(n))
	}
	return n, err
}

func TestRealDataShareTransferSpeedComparison(t *testing.T) {
	testFile := "/mnt/e/developer/results/data/1.zip"
	fi, err := os.Stat(testFile)
	if err != nil {
		t.Skipf("Test file %s not found, skipping benchmark test: %v", testFile, err)
		return
	}

	t.Run("Original (Without ReadFrom 32KB buffer)", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			f, err := os.Open(testFile)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			defer f.Close()

			pw := &noReaderFromResponseWriter{
				ResponseWriter: w,
				onWrite:        func(written int64) {},
			}
			http.ServeContent(pw, r, fi.Name(), fi.ModTime(), f)
		})

		ts := httptest.NewServer(handler)
		defer ts.Close()

		start := time.Now()
		res, err := ts.Client().Get(ts.URL)
		if err != nil {
			t.Fatalf("HTTP GET failed: %v", err)
		}
		defer res.Body.Close()

		buf := make([]byte, 32*1024)
		n, err := io.CopyBuffer(io.Discard, res.Body, buf)
		if err != nil {
			t.Fatalf("io.CopyBuffer failed: %v", err)
		}

		elapsed := time.Since(start)
		mb := float64(n) / (1024 * 1024)
		speedMBs := mb / elapsed.Seconds()
		fmt.Printf("\n--- BENCHMARK 1: Original Mode (No ReadFrom, 32KB Buffer) ---\nTransferred: %.2f MB | Time: %v | Speed: %.2f MB/s\n\n", mb, elapsed, speedMBs)
	})

	t.Run("Optimized Zero-Copy (With ReadFrom & 256KB Buffer)", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			f, err := os.Open(testFile)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			defer f.Close()

			pw := &progressResponseWriter{
				ResponseWriter: w,
				onWrite:        func(written int64) {},
			}
			http.ServeContent(pw, r, fi.Name(), fi.ModTime(), f)
		})

		ts := httptest.NewServer(handler)
		defer ts.Close()

		start := time.Now()
		res, err := ts.Client().Get(ts.URL)
		if err != nil {
			t.Fatalf("HTTP GET failed: %v", err)
		}
		defer res.Body.Close()

		buf := make([]byte, 256*1024)
		n, err := io.CopyBuffer(io.Discard, res.Body, buf)
		if err != nil {
			t.Fatalf("io.CopyBuffer failed: %v", err)
		}

		elapsed := time.Since(start)
		mb := float64(n) / (1024 * 1024)
		speedMBs := mb / elapsed.Seconds()
		fmt.Printf("\n--- BENCHMARK 2: Optimized Mode (With ReadFrom Zero-Copy & 256KB Buffer) ---\nTransferred: %.2f MB | Time: %v | Speed: %.2f MB/s\n\n", mb, elapsed, speedMBs)
	})

	t.Run("Optimized Multi-Thread Concurrent Range (4-Workers)", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			f, err := os.Open(testFile)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			defer f.Close()

			pw := &progressResponseWriter{
				ResponseWriter: w,
				onWrite:        func(written int64) {},
			}
			http.ServeContent(pw, r, fi.Name(), fi.ModTime(), f)
		})

		ts := httptest.NewServer(handler)
		defer ts.Close()

		fileSize := fi.Size()
		numWorkers := 4
		chunkSize := fileSize / int64(numWorkers)

		start := time.Now()
		var wg sync.WaitGroup

		for i := 0; i < numWorkers; i++ {
			wg.Add(1)
			startByte := int64(i) * chunkSize
			endByte := startByte + chunkSize - 1
			if i == numWorkers-1 {
				endByte = fileSize - 1
			}

			go func(workerID int, startB, endB int64) {
				defer wg.Done()
				req, err := http.NewRequest("GET", ts.URL, nil)
				if err != nil {
					return
				}
				req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", startB, endB))

				res, err := ts.Client().Do(req)
				if err != nil {
					return
				}
				defer res.Body.Close()

				buf := make([]byte, 256*1024)
				_, _ = io.CopyBuffer(io.Discard, res.Body, buf)
			}(i, startByte, endByte)
		}
		wg.Wait()

		elapsed := time.Since(start)
		mb := float64(fileSize) / (1024 * 1024)
		speedMBs := mb / elapsed.Seconds()
		fmt.Printf("\n--- BENCHMARK 3: Multi-Thread Concurrent Range Mode (4 Workers) ---\nTransferred: %.2f MB | Time: %v | Speed: %.2f MB/s\n\n", mb, elapsed, speedMBs)
	})
}
