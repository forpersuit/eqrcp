package p2p

import (
	"sync"
	"testing"
	"time"
)

func TestSignalingClientURL(t *testing.T) {
	clientDefault := NewSignalingClient("")
	if clientDefault.BaseURL != DefaultSignalingURL {
		t.Fatalf("expected default URL %s, got %s", DefaultSignalingURL, clientDefault.BaseURL)
	}

	customURL := "https://signal-custom.eqt.net.im"
	clientCustom := NewSignalingClient(customURL)
	if clientCustom.BaseURL != customURL {
		t.Fatalf("expected custom URL %s, got %s", customURL, clientCustom.BaseURL)
	}
}

func TestEngineInitialization(t *testing.T) {
	engine, err := NewEngine(nil)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}
	defer engine.Close()

	if engine.State() != StateNew {
		t.Fatalf("expected state %s, got %s", StateNew, engine.State())
	}

	if engine.PeerConnection == nil {
		t.Fatal("expected PeerConnection to be initialized")
	}
}

func TestHolePunchTimeout(t *testing.T) {
	engine, err := NewEngine(nil)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}
	defer engine.Close()

	var wg sync.WaitGroup
	wg.Add(1)

	var capturedState ConnectionState
	engine.SetOnStateChange(func(state ConnectionState) {
		if state == StateFailed {
			capturedState = state
			wg.Done()
		}
	})

	// Trigger quick 50ms hole punch timeout for testing
	engine.StartHolePunchTimeout(50 * time.Millisecond)

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		if capturedState != StateFailed {
			t.Fatalf("expected state %s, got %s", StateFailed, capturedState)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("hole punch timeout test timed out")
	}
}

func TestEngineClose(t *testing.T) {
	engine, err := NewEngine(nil)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	if err := engine.Close(); err != nil {
		t.Fatalf("failed to close engine: %v", err)
	}

	if engine.State() != StateClosed {
		t.Fatalf("expected closed state, got %s", engine.State())
	}
}
