package e2ee

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestDRMProbeHealthCheck(t *testing.T) {
	mock := NewMockDRMServer()
	defer mock.Close()

	// 1. Initial healthy state
	if !CheckDRMHealth(mock.URL()) {
		t.Fatal("expected MockDRMServer to be healthy initially")
	}

	// 2. Set unhealthy state (500)
	mock.SetHealthy(false, http.StatusInternalServerError)
	if CheckDRMHealth(mock.URL()) {
		t.Fatal("expected MockDRMServer to be unhealthy when status=500")
	}

	// 3. Recover to healthy
	mock.SetHealthy(true, http.StatusOK)
	if !CheckDRMHealth(mock.URL()) {
		t.Fatal("expected MockDRMServer to be healthy after recovery")
	}
}

func TestDRMProberBackgroundLoop(t *testing.T) {
	mock := NewMockDRMServer()
	defer mock.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stateChanges := make(chan bool, 10)
	onChange := func(online bool) {
		stateChanges <- online
	}

	// Start prober with fast 50ms interval for testing
	StartDRMProber(ctx, mock.URL(), 50*time.Millisecond, onChange)

	// Verify initial probe is true (received or atomic state true)
	select {
	case st := <-stateChanges:
		if !st {
			t.Fatal("expected initial probe state to be true")
		}
	case <-time.After(200 * time.Millisecond):
		if !IsDRMOnline() {
			t.Fatal("expected IsDRMOnline() to be true")
		}
	}

	// Set unhealthy
	mock.SetHealthy(false, http.StatusServiceUnavailable)
	select {
	case st := <-stateChanges:
		if st {
			t.Fatal("expected probe state change to false")
		}
	case <-time.After(500 * time.Millisecond):
		if IsDRMOnline() {
			t.Fatal("expected IsDRMOnline() to be false after mock degradation")
		}
	}

	// Recover
	mock.SetHealthy(true, http.StatusOK)
	select {
	case st := <-stateChanges:
		if !st {
			t.Fatal("expected probe state change to true")
		}
	case <-time.After(500 * time.Millisecond):
		if !IsDRMOnline() {
			t.Fatal("expected IsDRMOnline() to be true after recovery")
		}
	}
}
