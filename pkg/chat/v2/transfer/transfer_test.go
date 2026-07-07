package transfer

import (
	"bytes"
	"errors"
	"io"
	"testing"
	"time"

	"eqt/pkg/chat/v2/protocol"
)

func TestTransferJobStateTransitions(t *testing.T) {
	mgr := NewManager()

	var events []protocol.TransferEvent
	var eventTypes []protocol.EventType
	mgr.RegisterCallback(func(token string, et protocol.EventType, ev protocol.TransferEvent) {
		events = append(events, ev)
		eventTypes = append(eventTypes, et)
	})

	job := mgr.CreateJob("token-1", "job-1", "msg-123", "client-abc", "test.txt", 1000)

	if job.State != protocol.TransferQueued {
		t.Fatalf("job state = %s, want queued", job.State)
	}

	_ = mgr.StartJob("job-1")
	if job.State != protocol.TransferRunning {
		t.Fatalf("job state = %s, want running", job.State)
	}

	_ = mgr.CompleteJob("job-1")
	if job.State != protocol.TransferCompleted {
		t.Fatalf("job state = %s, want completed", job.State)
	}

	// We expect 3 callback triggers: Create (queued), Start (running), Complete (completed)
	if len(events) != 3 {
		t.Fatalf("callback triggers = %d, want 3", len(events))
	}

	if events[0].State != protocol.TransferQueued || events[1].State != protocol.TransferRunning || events[2].State != protocol.TransferCompleted {
		t.Fatalf("unexpected states sequence: %v", events)
	}

	if eventTypes[0] != protocol.EventTransferQueued || eventTypes[1] != protocol.EventTransferStarted || eventTypes[2] != protocol.EventTransferCompleted {
		t.Fatalf("unexpected event types: %v", eventTypes)
	}
}

func TestTransferProgressThrottling(t *testing.T) {
	mgr := NewManager()

	var events []protocol.TransferEvent
	mgr.RegisterCallback(func(token string, et protocol.EventType, ev protocol.TransferEvent) {
		events = append(events, ev)
	})

	// Total size = 100
	_ = mgr.CreateJob("token-pct", "job-pct", "msg-1", "client-1", "file.bin", 100)
	_ = mgr.StartJob("job-pct")

	// Flush callback logs for clean verification
	events = nil

	// Update bytes Done to 10 (10%). Percentage changes from 0 -> 10.
	// This must trigger callback.
	err := mgr.UpdateProgress("job-pct", 10)
	if err != nil {
		t.Fatal(err)
	}

	if len(events) != 1 {
		t.Fatalf("expected 1 callback event on 10%% progress, got = %d", len(events))
	}
	if events[0].Percent != 10 {
		t.Fatalf("percent = %d, want 10", events[0].Percent)
	}

	// Update bytes Done to 11 (11%). Percentage changes from 10 -> 11.
	// Since pct changed, it must trigger callback.
	err = mgr.UpdateProgress("job-pct", 11)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("expected 2 callback events, got = %d", len(events))
	}

	// Update bytes Done to 11 again. Percentage doesn't change (11 -> 11), time doesn't cross 200ms threshold.
	// This must be throttled (no callback).
	err = mgr.UpdateProgress("job-pct", 11)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("expected progress event to be throttled, got event count = %d", len(events))
	}

	// Manually inject a fake LastSentTime in job to simulate time lapse of 300ms
	job, _ := mgr.GetJob("job-pct")
	job.mu.Lock()
	job.LastSentTime = time.Now().Add(-300 * time.Millisecond)
	job.mu.Unlock()

	// Update bytes Done to 11 again. Percentage does not change, but 200ms elapsed.
	// This must trigger callback.
	err = mgr.UpdateProgress("job-pct", 11)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 {
		t.Fatalf("expected callback trigger after time lapse, got = %d", len(events))
	}
}

func TestProgressWriterAndReader(t *testing.T) {
	var buf bytes.Buffer
	var written int

	pw := NewProgressWriter(&buf, func(n int) {
		written += n
	})

	data := []byte("hello world")
	n, err := pw.Write(data)
	if err != nil {
		t.Fatal(err)
	}
	if n != len(data) || written != len(data) || buf.String() != "hello world" {
		t.Fatalf("Write mismatch: n = %d, written = %d", n, written)
	}

	var read int
	pr := NewProgressReader(bytes.NewReader(data), func(n int) {
		read += n
	})

	dest := make([]byte, 20)
	rn, err := pr.Read(dest)
	if err != io.EOF && err != nil {
		t.Fatal(err)
	}
	if rn != len(data) || read != len(data) || string(dest[:rn]) != "hello world" {
		t.Fatalf("Read mismatch: rn = %d, read = %d", rn, read)
	}
}

func TestTransferFailureAndCancellation(t *testing.T) {
	mgr := NewManager()

	var events []protocol.TransferEvent
	mgr.RegisterCallback(func(token string, et protocol.EventType, ev protocol.TransferEvent) {
		events = append(events, ev)
	})

	_ = mgr.CreateJob("token-f", "job-f", "", "", "t.bin", 100)

	err := mgr.FailJob("job-f", errors.New("network timeout"))
	if err != nil {
		t.Fatal(err)
	}
	job, _ := mgr.GetJob("job-f")
	if job.State != protocol.TransferFailed || job.Error != "network timeout" {
		t.Fatalf("fail job mismatch: State = %s, Error = %s", job.State, job.Error)
	}

	_ = mgr.CreateJob("token-c", "job-c", "", "", "t2.bin", 100)
	_ = mgr.CancelJob("job-c")
	job2, _ := mgr.GetJob("job-c")
	if job2.State != protocol.TransferCancelled || job2.Error != "cancelled by user" {
		t.Fatalf("cancel job mismatch: State = %s, Error = %s", job2.State, job2.Error)
	}
}
